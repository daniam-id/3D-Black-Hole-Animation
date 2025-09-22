import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass'

let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let controls: OrbitControls
let composer: EffectComposer
let blackHole: THREE.Mesh
let accretionDisk: THREE.Points
let photonSphere: THREE.Mesh
let jetStreams: THREE.Points
let starField: THREE.Points | null = null
let starFieldRotation: number = 0
let maxStars: number = 8000
let currentStarCount: number = 1500 // Restored for dense, realistic starfield while keeping performance optimizations
let lastCameraDistance: number = 0
const rotationSpeed: number = 0.0005 // Very subtle rotation

interface StarData {
  position: THREE.Vector3
  brightness: number
}

function createBlackHole(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(1.4, 128, 64) // Smaller radius, higher detail

  const vertexShader = `
    varying vec3 vPosition;
    varying vec3 vNormal;
    varying vec2 vUv;
    varying vec3 vWorldPosition;

    void main() {
      vPosition = (modelMatrix * vec4(position, 1.0)).xyz;
      vNormal = normalMatrix * normal;
      vUv = uv;
      vWorldPosition = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `

  const fragmentShader = `
    uniform vec3 cameraPosition;
    uniform float time;
    varying vec3 vPosition;
    varying vec3 vNormal;
    varying vec2 vUv;
    varying vec3 vWorldPosition;

    // Photon sphere radius (ISCO) ~ 3M, value scaled for visualization
    #define PHOTON_SPHERE_RADIUS 1.03

    // Event horizon radius = 2M, scaled for visualization
    #define EVENT_HORIZON_RADIUS 1.0

    void main() {
      vec3 normal = normalize(vNormal);
      vec3 viewDirection = normalize(cameraPosition - vPosition);

      // Enhanced gravitational lensing - stronger near edge, softer near center
      float distFromCenter = length(vWorldPosition.xy);
      float angleFactor = dot(normal, viewDirection);
      float lensingPower = 1.0 - smoothstep(0.0, PHOTON_SPHERE_RADIUS, distFromCenter);

      // Strong gravitational redshift near center
      float redshift = smoothstep(EVENT_HORIZON_RADIUS, PHOTON_SPHERE_RADIUS, distFromCenter);

      // Dynamic accretion disk shadow effect
      float diskShadow = 1.0 - smoothstep(0.0, 0.3, abs(vWorldPosition.y - 0.1));

      // Enhanced photon sphere glow
      float photonGlow = 1.0 - smoothstep(0.95, 1.1, distFromCenter);
      photonGlow = photonGlow * photonGlow * (0.5 + 0.5 * sin(time * 10.0 + vUv.x * 20.0));

      // Combine effects: true black absorption with subtle rim effects
      float alpha = 0.0; // Start with complete opacity

      // Add rim lighting at photon sphere
      alpha += photonGlow * 0.3;

      // Accretion disk corona effect
      float coronaRing = smoothstep(1.5, 1.8, distFromCenter) * (1.0 - smoothstep(1.8, 2.2, distFromCenter));
      alpha += coronaRing * 0.1;

      // Gravitational lensing distortion
      float distortion = lensingPower * (1.0 - abs(angleFactor));
      alpha += distortion * 0.05;

      // Apply disk shadow
      alpha *= (1.0 - diskShadow * 0.2);

      // Ensure black hole core remains dark
      if (distFromCenter < EVENT_HORIZON_RADIUS) {
        alpha = 0.0; // True event horizon
      }

      // Color shift due to gravitational redshift
      float blueShift = redshift;
      vec3 rimColor = mix(vec3(0.8, 0.9, 1.0), vec3(0.3, 0.4, 0.8), redshift);

      gl_FragColor = vec4(rimColor * photonGlow * 0.5, alpha);
    }
  `

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      cameraPosition: { value: new THREE.Vector3() },
      time: { value: 0 }
    },
    transparent: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  })

  const mesh = new THREE.Mesh(geometry, material)
  return mesh
}

function kelvinToRgb(kelvin: number): [number, number, number] {
  // Enhanced color temperature mapping with better scientific accuracy
  const temp = kelvin / 100

  let r, g, b

  if (temp <= 66) {
    r = 255
    g = temp
    g = 99.4708025861 * Math.log(g) - 161.1195681661
    g < 0 ? g = 0 : g > 255 ? g = 255 : 0
    if (temp <= 19) {
      b = 0
    } else {
      b = temp - 10
      b = 138.5177312231 * Math.log(b) - 305.0447927307
      b < 0 ? b = 0 : b > 255 ? b = 255 : 0
    }
  } else {
    r = temp - 60
    r = 329.698727446 * Math.pow(r, -0.1332047592)
    r > 255 ? r = 255 : r < 0 ? r = 0 : 0
    g = temp - 60
    g = 288.1221695283 * Math.pow(g, -0.0755148492)
    g > 255 ? g = 255 : g < 0 ? g = 0 : 0
    b = 255
  }

  // Add temperature-dependent intensity scaling for more realistic emission
  let intensityScale = 1.0
  if (kelvin > 100000) {
    intensityScale = 2.0 * (kelvin / 1000000) // Very hot sources appear brighter
  } else if (kelvin < 3000) {
    intensityScale = 0.5 // Cooler sources are dimmer
  }

  return [
    Math.min(1.0, Math.round(r) / 255 * intensityScale),
    Math.min(1.0, Math.round(g) / 255 * intensityScale),
    Math.min(1.0, Math.round(b) / 255 * intensityScale)
  ]
}

function createAccretionDisk(): THREE.Points {
  const particleCount = 2000 // Reduced from 5000 for lighter initial load
  const positions = new Float32Array(particleCount * 3)
  const velocities = new Float32Array(particleCount * 3)
  const colors = new Float32Array(particleCount * 3)
  const temperatures = new Float32Array(particleCount) // Store temperature for Doppler

  for (let i = 0; i < particleCount; i++) {
    const angle = Math.random() * Math.PI * 2
    const radius = 2 + Math.random() * 3 // between 2 and 5, extended for layers
    const height = (Math.random() - 0.5) * 0.3 // small height variation, add turbulence later

    positions[i * 3] = Math.cos(angle) * radius
    positions[i * 3 + 1] = height
    positions[i * 3 + 2] = Math.sin(angle) * radius

    // Initialize tangential velocity for orbital motion
    const speed = 0.01 + Math.random() * 0.005 // slight variation in speed
    velocities[i * 3] = -Math.sin(angle) * speed // perpendicular to radius
    velocities[i * 3 + 1] = 0 // no vertical velocity
    velocities[i * 3 + 2] = Math.cos(angle) * speed

    // Temperature decreases with radius: inner ~1e6 K, outer ~1e5 K
    const temperature = 1000000 / (radius - 1) // Approximate falloff
    temperatures[i] = Math.max(50000, temperature) // Min temp for outer

    const [r, g, b] = kelvinToRgb(temperatures[i])
    colors[i * 3] = r
    colors[i * 3 + 1] = g
    colors[i * 3 + 2] = b
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('temperature', new THREE.BufferAttribute(temperatures, 1))

  const material = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      cameraPosition: { value: new THREE.Vector3() }
    },
    vertexShader: `
      attribute float temperature;
      attribute vec3 velocity;
      varying vec3 vColor;
      varying float vDopplerFactor;

      void main() {
        vec3 worldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        vec3 viewDirection = normalize(cameraPosition - worldPosition);
        float velocityAlongView = dot(normalize(velocity), viewDirection);

        // Simple relativistic Doppler: blue shift for approaching
        vDopplerFactor = 1.0 / (1.0 - velocityAlongView * 0.1); // Approximation

        vec3 dopplerColor = temperature > 100000.0 ? vec3(1.0, 0.8, 0.7) : // Hot
                           temperature > 50000.0 ? vec3(1.0, 0.5, 0.2) : // Warm
                           vec3(1.0, 0.2, 0.0); // Cool
        vColor = dopplerColor * vDopplerFactor;

        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 3.0 * (300.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;

      void main() {
        float strength = 1.0 - distance(gl_PointCoord, vec2(0.5));
        strength = pow(strength, 2.0);
        gl_FragColor = vec4(vColor, strength);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  })

  const points = new THREE.Points(geometry, material)
  return points
}

function createPhotonSphere(): THREE.Mesh {
  const geometry = new THREE.TorusGeometry(3, 0.1, 16, 100)
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending
  })
  return new THREE.Mesh(geometry, material)
}

function createJetStreams(): THREE.Points {
  const particleCount = 1000
  const positions = new Float32Array(particleCount * 3)
  const colors = new Float32Array(particleCount * 3)
  const velocities = new Float32Array(particleCount * 3)

  for (let i = 0; i < particleCount; i++) {
    const pole = Math.random() > 0.5 ? 1 : -1 // Top or bottom
    const angle = Math.random() * Math.PI * 2
    const radius = 0.1 + Math.random() * 0.2 // Small radius near poles
    const height = pole * (2 + Math.random() * 5) // Extending upwards/downwards

    positions[i * 3] = Math.cos(angle) * radius
    positions[i * 3 + 1] = height
    positions[i * 3 + 2] = Math.sin(angle) * radius

    colors[i * 3] = 0.8
    colors[i * 3 + 1] = 0.8
    colors[i * 3 + 2] = 1.0

    velocities[i * 3 + 1] = pole * 0.02 // Vertical velocity upwards/downwards
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3))

  const material = new THREE.PointsMaterial({
    vertexColors: true,
    size: 0.02,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending
  })

  const points = new THREE.Points(geometry, material)
  return points
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000
  return x - Math.floor(x)
}

function createStarField(): THREE.Points {
  const positions = new Float32Array(maxStars * 3)
  const colors = new Float32Array(maxStars * 3)

  // Initialize with base stars
  for (let i = 0; i < currentStarCount; i++) {
    const seed = seededRandom(i * 1000)
    const distance = 50 + seed * 200 // Initial distance range
    const theta = Math.acos(2 * seededRandom(i * 2000) - 1)
    const phi = seededRandom(i * 3000) * Math.PI * 2

    const x = distance * Math.sin(theta) * Math.cos(phi)
    const y = distance * Math.sin(theta) * Math.sin(phi)
    const z = distance * Math.cos(theta)

    positions[i * 3] = x
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = z

    // Brightness varies with simulated magnitude
    const brightness = 0.2 + Math.pow(seededRandom(i * 4000), 2) * 0.8
    colors[i * 3] = brightness
    colors[i * 3 + 1] = brightness
    colors[i * 3 + 2] = brightness
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  const material = new THREE.PointsMaterial({
    vertexColors: true,
    size: 2.0,
    transparent: true,
    opacity: 1.0,
    blending: THREE.AdditiveBlending
  })

  const points = new THREE.Points(geometry, material)
  return points
}

function updateStarField(): void {
  if (!starField) return

  const cameraDistance = camera.position.length()
  const distanceChange = Math.abs(cameraDistance - lastCameraDistance)

  // Add rotation to star field for subtle motion
  starFieldRotation += rotationSpeed
  starField.rotation.y = starFieldRotation

  // Expand star field when camera moves significantly or zooms out
  if (distanceChange > 20 || cameraDistance > lastCameraDistance + 100) {
    const starsNeeded = Math.min(
      maxStars,
      Math.floor(currentStarCount + (cameraDistance - lastCameraDistance) * 2)
    )

    if (starsNeeded > currentStarCount) {
      const geometry = starField.geometry
      const positions = geometry.attributes.position.array as Float32Array
      const colors = geometry.attributes.color.array as Float32Array

      // Add stars progressively (max 50 per frame) to prevent frame drops
      const starsToAdd = Math.min(50, starsNeeded - currentStarCount)
      const newStarCount = currentStarCount + starsToAdd

      // Add new stars at greater distances
      for (let i = currentStarCount; i < newStarCount; i++) {
        // Generate stars progressively farther out
        const baseDistance = 50 + (i - 3000) * 10 // Scale distance with star count
        const seed = seededRandom(i * 1000)
        const distance = baseDistance + seed * Math.max(100, cameraDistance)
        const theta = Math.acos(2 * seededRandom(i * 2000) - 1)
        const phi = seededRandom(i * 3000) * Math.PI * 2

        const x = distance * Math.sin(theta) * Math.cos(phi)
        const y = distance * Math.sin(theta) * Math.sin(phi)
        const z = distance * Math.cos(theta)

        positions[i * 3] = x
        positions[i * 3 + 1] = y
        positions[i * 3 + 2] = z

        // Fainter stars at greater distances
        const distanceFactor = Math.max(0.1, 1.0 - Math.log10(distance + 1) * 0.1)
        const brightness = 0.1 + Math.pow(seededRandom(i * 4000), 2) * 0.9 * distanceFactor
        colors[i * 3] = brightness
        colors[i * 3 + 1] = brightness
        colors[i * 3 + 2] = brightness
      }

      geometry.attributes.position.needsUpdate = true
      geometry.attributes.color.needsUpdate = true
      geometry.setDrawRange(0, newStarCount)
      currentStarCount = newStarCount

      // Don't update lastCameraDistance yet - continue adding stars if needed
      if (newStarCount >= starsNeeded) {
        lastCameraDistance = cameraDistance
      }
    } else {
      lastCameraDistance = cameraDistance
    }
  }
}

function init(): void {
  // Create scene
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x000011) // Very dark blue for space

  // Create camera with optimal initial viewing distance for comfortable black hole framing
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
  camera.position.set(0, 3, 12) // Increased distance for better framing: black hole fits nicely in view

  // Create renderer
  const canvas = document.getElementById('canvas') as HTMLCanvasElement
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(window.devicePixelRatio)

  // Create post-processing composer
  composer = new EffectComposer(renderer)
  const renderPass = new RenderPass(scene, camera)
  composer.addPass(renderPass)

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1.5, // strength
    0.4, // radius
    0.85 // threshold
  )
  composer.addPass(bloomPass)

  // Create controls optimized for touchpad interaction
  controls = new OrbitControls(camera, canvas)

  // Enable all movement axes with touchpad-optimized settings
  controls.enableRotate = true         // Orbital rotation around target
  controls.enableZoom = true           // Zoom in/out with two-finger gestures on touchpad
  controls.enablePan = true            // Pan camera position horizontally/vertically

  // Damping and responsiveness specifically tuned for touchpad control
  controls.enableDamping = true        // Enable smooth motion physics
  controls.dampingFactor = 0.15        // Higher damping (smoother) for touchpad gesture feel

  // Adjust control sensitivities for touchpad operation
  controls.rotateSpeed = 0.8           // Balanced rotation speed for touchpad dragging
  controls.panSpeed = 1.0              // Normal pan speed for touchpad interaction
  controls.zoomSpeed = 1.2             // Responsive zoom for touchpad scroll/two-finger

  // Movement boundaries for comprehensive exploration
  controls.screenSpacePanning = true   // Screen-space panning for intuitive movement
  controls.minDistance = 0.1           // Very close inspection capability
  controls.maxDistance = 2000000       // Essentially unlimited zoom out
  controls.maxPolarAngle = Math.PI     // Full 360° vertical rotation (pole to pole)
  controls.minPolarAngle = 0           // Complete coverage from above to below

  // Precise centering on black hole for consistent orientation
  controls.target.set(0, 0, 0)         // Target black hole center (0,0,0)

  // Ensure controls are properly initialized for touchpad
  controls.update()                    // Initial orientation setup

  // Enable touch gestures (especially important for touchpad compatibility)
  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,      // Single finger drag for rotation
    TWO: THREE.TOUCH.DOLLY_PAN,   // Two fingers for zoom + pan
  }

  // Ensure mouse events are properly configured for touchpad usage
  // Three.js OrbitControls uses default mouse mappings by default

  // Initialize infinite star field
  starField = createStarField()
  scene.add(starField)
  lastCameraDistance = camera.position.length()

  // Add black hole to scene
  blackHole = createBlackHole()
  scene.add(blackHole)

  // Add accretion disk to scene
  accretionDisk = createAccretionDisk()
  scene.add(accretionDisk)

  // Add photon sphere
  photonSphere = createPhotonSphere()
  scene.add(photonSphere)

  // Add jet streams
  jetStreams = createJetStreams()
  scene.add(jetStreams)

  // Add event listeners
  window.addEventListener('resize', onWindowResize)

  // Start animation loop
  animate()
}

function animateDiskPhysics(): void {
  const positions = accretionDisk.geometry.attributes.position
  const velocities = accretionDisk.geometry.attributes.velocity

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i)
    const z = positions.getZ(i)

    const distance = Math.sqrt(x * x + z * z)
    const gravityStrength = 0.0001 / (distance * distance) // Inverse square law approximation

    // Gravitational acceleration towards center
    const accelX = -gravityStrength * (x / distance)
    const accelZ = -gravityStrength * (z / distance)

    // Update velocity
    velocities.setX(i, velocities.getX(i) + accelX)
    velocities.setZ(i, velocities.getZ(i) + accelZ)

    // Update position
    positions.setX(i, x + velocities.getX(i))
    positions.setZ(i, z + velocities.getZ(i))

    // Add turbulence
    positions.setY(i, positions.getY(i) + (Math.random() - 0.5) * 0.005)
    positions.setX(i, positions.getX(i) + (Math.random() - 0.5) * 0.002)
    positions.setZ(i, positions.getZ(i) + (Math.random() - 0.5) * 0.002)

    // Reset particles that fall into the black hole or go too far
    if (distance < 1.5 || distance > 7) {
      const angle = Math.random() * Math.PI * 2
      const radius = 2.5 + Math.random() * 2 // respawn between 2.5 and 4.5
      positions.setX(i, Math.cos(angle) * radius)
      positions.setZ(i, Math.sin(angle) * radius)
      positions.setY(i, (Math.random() - 0.5) * 0.3)
      velocities.setX(i, -Math.sin(angle) * 0.01)
      velocities.setZ(i, Math.cos(angle) * 0.01)
      velocities.setY(i, 0)
    }
  }

  positions.needsUpdate = true
  velocities.needsUpdate = true
}

function animateJetPhysics(): void {
  const positions = jetStreams.geometry.attributes.position
  const velocities = jetStreams.geometry.attributes.velocity

  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i)
    const pole = y > 0 ? 1 : -1

    // Move upwards/downwards with acceleration
    velocities.setY(i, velocities.getY(i) + pole * 0.001)
    positions.setY(i, y + velocities.getY(i))

    // Reset if too far
    if (Math.abs(y) > 10) {
      positions.setY(i, pole * 2)
      velocities.setY(i, pole * 0.02)
    }
  }

  positions.needsUpdate = true
  velocities.needsUpdate = true
}

function animate(): void {
  requestAnimationFrame(animate)
  controls.update()
  animateDiskPhysics()
  animateJetPhysics()
  updateStarField() // Update infinite star field with rotation and expansion
  // Update uniforms
  const material = accretionDisk.material as THREE.ShaderMaterial
  material.uniforms.time.value = performance.now() * 0.001
  material.uniforms.cameraPosition.value.copy(camera.position)
  composer.render()
}

function onWindowResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  composer.setSize(window.innerWidth, window.innerHeight)
}

init()
