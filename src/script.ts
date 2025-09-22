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

function createBlackHole(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(1.5, 64, 32)

  const vertexShader = `
    varying vec3 vPosition;
    varying vec3 vNormal;

    void main() {
      vPosition = (modelMatrix * vec4(position, 1.0)).xyz;
      vNormal = normalMatrix * normal;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `

  const fragmentShader = `
    varying vec3 vPosition;
    varying vec3 vNormal;

    void main() {
      vec3 normal = normalize(vNormal);
      vec3 viewDirection = normalize(cameraPosition - vPosition);

      // Simulate gravitational lensing effect by fading opacity based on viewing angle
      float angleFactor = dot(normal, viewDirection);
      float lensingOpacity = smoothstep(-0.1, 0.9, angleFactor);

      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0 - lensingOpacity);
    }
  `

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    side: THREE.DoubleSide
  })

  const mesh = new THREE.Mesh(geometry, material)
  return mesh
}

function createAccretionDisk(): THREE.Points {
  const particleCount = 2000
  const positions = new Float32Array(particleCount * 3)
  const velocities = new Float32Array(particleCount * 3)
  const colors = new Float32Array(particleCount * 3)

  for (let i = 0; i < particleCount; i++) {
    const angle = Math.random() * Math.PI * 2
    const radius = 2 + Math.random() * 2 // between 2 and 4
    const height = (Math.random() - 0.5) * 0.3 // small height variation

    positions[i * 3] = Math.cos(angle) * radius
    positions[i * 3 + 1] = height
    positions[i * 3 + 2] = Math.sin(angle) * radius

    // Initialize tangential velocity for orbital motion
    const speed = 0.01 + Math.random() * 0.005 // slight variation in speed
    velocities[i * 3] = -Math.sin(angle) * speed // perpendicular to radius
    velocities[i * 3 + 1] = 0 // no vertical velocity
    velocities[i * 3 + 2] = Math.cos(angle) * speed

    // Improved color gradient: white-hot inner, yellow, orange, red outer
    const innerGradient = Math.max(0, (radius - 4) / -2) // 1 at inner edge (2), 0 at outer (4)
    colors[i * 3] = 1.0 // red base
    colors[i * 3 + 1] = 0.5 + innerGradient * 0.5 // green from 0.5 to 1.0
    colors[i * 3 + 2] = innerGradient // blue from 0 to 1 at inner
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  const material = new THREE.PointsMaterial({
    vertexColors: true,
    size: 0.05,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending
  })

  const points = new THREE.Points(geometry, material)
  return points
}

function init(): void {
  // Create scene
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x000011) // Very dark blue for space

  // Create camera
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
  camera.position.z = 5

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

  // Create controls
  controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.05

  // Add black hole to scene
  blackHole = createBlackHole()
  scene.add(blackHole)

  // Add accretion disk to scene
  accretionDisk = createAccretionDisk()
  scene.add(accretionDisk)

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

    // Reset particles that fall into the black hole
    if (distance < 1.5) {
      const angle = Math.random() * Math.PI * 2
      const radius = 3 + Math.random() * 1 // respawn further out
      positions.setX(i, Math.cos(angle) * radius)
      positions.setZ(i, Math.sin(angle) * radius)
      velocities.setX(i, -Math.sin(angle) * 0.01)
      velocities.setZ(i, Math.cos(angle) * 0.01)
    }
  }

  positions.needsUpdate = true
  velocities.needsUpdate = true
}

function animate(): void {
  requestAnimationFrame(animate)
  controls.update()
  animateDiskPhysics()
  composer.render()
}

function onWindowResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  composer.setSize(window.innerWidth, window.innerHeight)
}

init()
