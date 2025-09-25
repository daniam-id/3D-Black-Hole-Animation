// @ts-ignore
import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js'
// @ts-ignore
import { OrbitControls } from 'https://unpkg.com/three@0.162.0/examples/jsm/controls/OrbitControls.js'
// @ts-ignore
import { EffectComposer } from 'https://unpkg.com/three@0.162.0/examples/jsm/postprocessing/EffectComposer.js'
// @ts-ignore
import { RenderPass } from 'https://unpkg.com/three@0.162.0/examples/jsm/postprocessing/RenderPass.js'
// @ts-ignore
import { UnrealBloomPass } from 'https://unpkg.com/three@0.162.0/examples/jsm/postprocessing/UnrealBloomPass.js'
// @ts-ignore
import { ShaderPass } from 'https://unpkg.com/three@0.162.0/examples/jsm/postprocessing/ShaderPass.js'
// @ts-ignore
import { GPUComputationRenderer } from 'https://unpkg.com/three@0.162.0/examples/jsm/misc/GPUComputationRenderer.js'

let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let controls: OrbitControls
let composer: EffectComposer
let lensingPass: ShaderPass
let bloomPass: UnrealBloomPass
let blackHole: THREE.Mesh
let accretionDisk: THREE.Points
let photonSphere: THREE.Mesh
let jetStreams: THREE.Points
let starField: THREE.LOD | null = null
let starFieldRotation: number = 0
let maxStars: number = 8000
let currentStarCount: number = 1500 // Restored for dense, realistic starfield while keeping performance optimizations
let lastCameraDistance: number = 0
const rotationSpeed: number = 0.0005 // Very subtle rotation

// GPU Computation for particles
let gpuComputeDisk: GPUComputationRenderer | null = null
let positionVariableDisk: any
let velocityVariableDisk: any
let gpuComputeJets: GPUComputationRenderer | null = null
let positionVariableJets: any
let velocityVariableJets: any
const TEXTURE_WIDTH = 64; // For ~4096 particles, but we'll use 2000/1000


function createBlackHole(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(1.4, 256, 128) // Enhanced detail for perfect spherical appearance

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
    uniform float time;
    varying vec3 vPosition;
    varying vec3 vNormal;
    varying vec2 vUv;
    varying vec3 vWorldPosition;

    // Event horizon radius - the true black sphere boundary
    #define EVENT_HORIZON_RADIUS 1.0

    // Photon sphere radius (ISCO) - where photons orbit
    #define PHOTON_SPHERE_RADIUS 1.03

    void main() {
      // Calculate distance from center for proper spherical definition
      float distFromCenter = length(vWorldPosition.xy + vWorldPosition.z * 0.1);

      // View direction for orientation-dependent effects
      vec3 normal = normalize(vNormal);
      vec3 viewDirection = normalize(cameraPosition - vPosition);
      float angleFactor = dot(normal, viewDirection);

      // === CORE BLACK HOLE SPHERE ===
      // The event horizon is absolutely black - this defines the sphere
      if (distFromCenter <= EVENT_HORIZON_RADIUS) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); // Pure black sphere
        return; // Exit early for clean black sphere
      }

      // === RIM EFFECTS OUTSIDE EVENT HORIZON ===
      float outsideEventHorizon = distFromCenter - EVENT_HORIZON_RADIUS;

      // Enhanced photon sphere glow at just the right distance
      float photonSphereDistance = abs(distFromCenter - PHOTON_SPHERE_RADIUS);
      float photonGlow = 1.0 - smoothstep(0.0, 0.05, photonSphereDistance);
      photonGlow = photonGlow * photonGlow; // Sharpen the effect
      photonGlow *= (0.6 + 0.4 * sin(time * 8.0 + vUv.x * 15.0 + vUv.y * 8.0)); // Animated

      // Gravitational redshift effect near event horizon
      float redshiftFactor = 1.0 - smoothstep(EVENT_HORIZON_RADIUS, PHOTON_SPHERE_RADIUS, distFromCenter);
      redshiftFactor = pow(redshiftFactor, 2.0); // Sharper falloff

      // Accretion disk grazing effect
      float diskGrazing = 1.0 - smoothstep(0.0, 0.4, abs(vWorldPosition.y));
      diskGrazing *= (1.0 - smoothstep(PHOTON_SPHERE_RADIUS, 1.6, distFromCenter));

      // Combined rim color: blue-shifted photons at redshift boundary
      vec3 rimColor = mix(vec3(0.1, 0.15, 0.6), vec3(0.3, 0.4, 0.8), redshiftFactor);

      // Calculate final alpha for rim effects
      float alpha = 0.0;
      alpha += photonGlow * 0.4;        // Photon sphere glow
      alpha += redshiftFactor * 0.2;    // Gravitational redshift
      alpha += diskGrazing * 0.3;       // Disk illumination effects

      // Ensure smooth alpha blending outside event horizon
      alpha *= (1.0 - smoothstep(PHOTON_SPHERE_RADIUS + 0.1, PHOTON_SPHERE_RADIUS + 0.3, distFromCenter));

      // Apply subtle color to rim effects
      vec3 finalColor = rimColor * alpha * 0.6; // Slightly dimmed for realism

      gl_FragColor = vec4(finalColor, alpha);
    }
  `

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      time: { value: 0 }
    },
    transparent: true,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    depthWrite: true
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
  const particleCount = 2000
  const positions = new Float32Array(particleCount * 3)
  const velocities = new Float32Array(particleCount * 3)
  const colors = new Float32Array(particleCount * 3)
  const temperatures = new Float32Array(particleCount)

  // Initialize data as before
  for (let i = 0; i < particleCount; i++) {
    const angle = Math.random() * Math.PI * 2
    const radius = 2 + Math.random() * 3
    const height = (Math.random() - 0.5) * 0.3

    positions[i * 3] = Math.cos(angle) * radius
    positions[i * 3 + 1] = height
    positions[i * 3 + 2] = Math.sin(angle) * radius

    const speed = 0.01 + Math.random() * 0.005
    velocities[i * 3] = -Math.sin(angle) * speed
    velocities[i * 3 + 1] = 0
    velocities[i * 3 + 2] = Math.cos(angle) * speed

    const temperature = 1000000 / (radius - 1)
    temperatures[i] = Math.max(50000, temperature)

    const [r, g, b] = kelvinToRgb(temperatures[i])
    colors[i * 3] = r * 0.3
    colors[i * 3 + 1] = g * 0.3
    colors[i * 3 + 2] = b * 0.3
  }

  // GPU Setup
  if (!gpuComputeDisk) {
    gpuComputeDisk = new GPUComputationRenderer(TEXTURE_WIDTH, TEXTURE_WIDTH, renderer);

    const positionTexture = gpuComputeDisk.createTexture();
    const velocityTexture = gpuComputeDisk.createTexture();

    // Fill initial data (flatten to 2D texture)
    const posData = new Float32Array(TEXTURE_WIDTH * TEXTURE_WIDTH * 4);
    const velData = new Float32Array(TEXTURE_WIDTH * TEXTURE_WIDTH * 4);
    for (let i = 0; i < particleCount; i++) {
      const idx = i * 4;
      posData[idx] = positions[i * 3];
      posData[idx + 1] = positions[i * 3 + 1];
      posData[idx + 2] = positions[i * 3 + 2];
      posData[idx + 3] = 1.0; // w=1 for active

      velData[idx] = velocities[i * 3];
      velData[idx + 1] = velocities[i * 3 + 1];
      velData[idx + 2] = velocities[i * 3 + 2];
      velData[idx + 3] = 0.0;
    }
    gpuComputeDisk.init();
    positionVariableDisk = gpuComputeDisk.addVariable('texturePosition', positionComputeShader, positionTexture);
    velocityVariableDisk = gpuComputeDisk.addVariable('textureVelocity', velocityComputeShader, velocityTexture);

    gpuComputeDisk.setVariableDependencies(positionVariableDisk, [positionVariableDisk, velocityVariableDisk]);
    gpuComputeDisk.setVariableDependencies(velocityVariableDisk, [positionVariableDisk, velocityVariableDisk]);

    positionVariableDisk.material.uniforms['time'] = { value: 0 };
    velocityVariableDisk.material.uniforms['time'] = { value: 0 };
    velocityVariableDisk.material.uniforms['gravityStrength'] = { value: 0.0001 };

    gpuComputeDisk.init();
  }

  // Copy initial data to textures
  const posArray = positionVariableDisk.texture.image.data as Float32Array;
  const velArray = velocityVariableDisk.texture.image.data as Float32Array;
  for (let i = 0; i < particleCount; i++) {
    const idx = i * 4;
    posArray[idx] = positions[i * 3];
    posArray[idx + 1] = positions[i * 3 + 1];
    posArray[idx + 2] = positions[i * 3 + 2];
    posArray[idx + 3] = 1.0;

    velArray[idx] = velocities[i * 3];
    velArray[idx + 1] = velocities[i * 3 + 1];
    velArray[idx + 2] = velocities[i * 3 + 2];
    velArray[idx + 3] = 0.0;
  }
  positionVariableDisk.texture.needsUpdate = true;
  velocityVariableDisk.texture.needsUpdate = true;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('temperature', new THREE.BufferAttribute(temperatures, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      cameraPosition: { value: new THREE.Vector3() }
    },
    vertexShader: `
      attribute float temperature;
      varying vec3 vColor;
      varying float vDopplerFactor;

      void main() {
        vec3 worldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        vec3 viewDirection = normalize(cameraPosition - worldPosition);
        // Simplified Doppler without velocity attribute (use position-derived)
        float radialVel = length(worldPosition.xz) * 0.01; // Approx orbital speed
        vDopplerFactor = 1.0 / (1.0 - radialVel * 0.1);

        vec3 dopplerColor = temperature > 100000.0 ? vec3(1.0, 0.8, 0.7) :
                           temperature > 50000.0 ? vec3(1.0, 0.5, 0.2) :
                           vec3(1.0, 0.2, 0.0);
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

// Compute shaders for disk
const positionComputeShader = `
  uniform float time;
  uniform float gravityStrength;
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec3 pos = texture2D( texturePosition, uv ).xyz;
    vec3 vel = texture2D( textureVelocity, uv ).xyz;

    vec2 xy = pos.xz; // Disk in xz plane
    float dist = length(xy);
    if (dist > 0.0) {
      vec2 accel = -gravityStrength * xy / (dist * dist);
      vel.xz += accel * 0.016; // dt approx
    }

    // Orbital tangential adjustment (simple)
    float perpX = -vel.z * 0.001;
    float perpZ = vel.x * 0.001;
    vel.x += perpX;
    vel.z += perpZ;

    // Update position
    pos += vel * 0.016;

    // Reset if too close or far
    if (dist < 1.5 || dist > 7.0) {
      float angle = time * 0.1 + uv.x * 6.28;
      pos.x = cos(angle) * (2.5 + uv.y * 2.0);
      pos.z = sin(angle) * (2.5 + uv.y * 2.0);
      pos.y = (uv.x - 0.5) * 0.3;
      vel = vec3(-sin(angle) * 0.01, 0.0, cos(angle) * 0.01);
    }

    // Add turbulence
    pos.y += (sin(time + uv.x * 10.0) * 0.005);
    pos.x += (cos(time + uv.y * 10.0) * 0.002);
    pos.z += (sin(time + uv.x * 10.0) * 0.002);

    gl_FragColor = vec4( pos, 1.0 );
  }
`;

const velocityComputeShader = `
  uniform float time;
  uniform float gravityStrength;
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec3 pos = texture2D( texturePosition, uv ).xyz;
    vec3 vel = texture2D( textureVelocity, uv ).xyz;

    vec2 xy = pos.xz;
    float dist = length(xy);
    if (dist > 0.0) {
      vec2 accel = -gravityStrength * xy / (dist * dist);
      vel.xz += accel * 0.016;
    }

    // Additional turbulence in velocity
    vel += vec3( sin(time + uv.x * 10.0) * 0.001, cos(time + uv.y * 10.0) * 0.002, sin(time + uv.x * 10.0) * 0.001 );

    gl_FragColor = vec4( vel, 0.0 );
  }
`;

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

  // Initialize data
  for (let i = 0; i < particleCount; i++) {
    const pole = Math.random() > 0.5 ? 1 : -1
    const angle = Math.random() * Math.PI * 2
    const radius = 0.1 + Math.random() * 0.2
    const height = pole * (2 + Math.random() * 5)

    positions[i * 3] = Math.cos(angle) * radius
    positions[i * 3 + 1] = height
    positions[i * 3 + 2] = Math.sin(angle) * radius

    colors[i * 3] = 0.8
    colors[i * 3 + 1] = 0.8
    colors[i * 3 + 2] = 1.0

    velocities[i * 3 + 1] = pole * 0.02
  }

  // GPU Setup for jets
  if (!gpuComputeJets) {
    gpuComputeJets = new GPUComputationRenderer(TEXTURE_WIDTH, TEXTURE_WIDTH, renderer);

    const positionTextureJets = gpuComputeJets.createTexture();
    const velocityTextureJets = gpuComputeJets.createTexture();

    const posDataJets = new Float32Array(TEXTURE_WIDTH * TEXTURE_WIDTH * 4);
    const velDataJets = new Float32Array(TEXTURE_WIDTH * TEXTURE_WIDTH * 4);
    for (let i = 0; i < particleCount; i++) {
      const idx = i * 4;
      posDataJets[idx] = positions[i * 3];
      posDataJets[idx + 1] = positions[i * 3 + 1];
      posDataJets[idx + 2] = positions[i * 3 + 2];
      posDataJets[idx + 3] = 1.0;

      velDataJets[idx] = velocities[i * 3];
      velDataJets[idx + 1] = velocities[i * 3 + 1];
      velDataJets[idx + 2] = velocities[i * 3 + 2];
      velDataJets[idx + 3] = 0.0;
    }
    gpuComputeJets.init();
    positionVariableJets = gpuComputeJets.addVariable('texturePositionJets', jetPositionComputeShader, positionTextureJets);
    velocityVariableJets = gpuComputeJets.addVariable('textureVelocityJets', jetVelocityComputeShader, velocityTextureJets);

    gpuComputeJets.setVariableDependencies(positionVariableJets, [positionVariableJets, velocityVariableJets]);
    gpuComputeJets.setVariableDependencies(velocityVariableJets, [positionVariableJets, velocityVariableJets]);

    positionVariableJets.material.uniforms['time'] = { value: 0 };
    velocityVariableJets.material.uniforms['time'] = { value: 0 };
    velocityVariableJets.material.uniforms['acceleration'] = { value: 0.001 };

    gpuComputeJets.init();
  }

  // Copy initial data
  const posArrayJets = positionVariableJets.texture.image.data as Float32Array;
  const velArrayJets = velocityVariableJets.texture.image.data as Float32Array;
  for (let i = 0; i < particleCount; i++) {
    const idx = i * 4;
    posArrayJets[idx] = positions[i * 3];
    posArrayJets[idx + 1] = positions[i * 3 + 1];
    posArrayJets[idx + 2] = positions[i * 3 + 2];
    posArrayJets[idx + 3] = 1.0;

    velArrayJets[idx] = velocities[i * 3];
    velArrayJets[idx + 1] = velocities[i * 3 + 1];
    velArrayJets[idx + 2] = velocities[i * 3 + 2];
    velArrayJets[idx + 3] = 0.0;
  }
  positionVariableJets.texture.needsUpdate = true;
  velocityVariableJets.texture.needsUpdate = true;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

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

// Compute shaders for jets (simple linear motion)
const jetPositionComputeShader = `
  uniform float time;
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec3 pos = texture2D( texturePositionJets, uv ).xyz;
    vec3 vel = texture2D( textureVelocityJets, uv ).xyz;

    pos += vel * 0.016;

    // Reset if too far
    if (abs(pos.y) > 10.0) {
      float pole = sign(pos.y);
      pos.y = pole * 2.0;
      vel.y = pole * 0.02;
    }

    gl_FragColor = vec4( pos, 1.0 );
  }
`;

const jetVelocityComputeShader = `
  uniform float time;
  uniform float acceleration;
  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec3 pos = texture2D( texturePositionJets, uv ).xyz;
    vec3 vel = texture2D( textureVelocityJets, uv ).xyz;

    // Accelerate vertically
    float pole = sign(pos.y);
    vel.y += pole * acceleration;

    gl_FragColor = vec4( vel, 0.0 );
  }
`;

function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000
  return x - Math.floor(x)
}

function createStarField(): THREE.LOD {
  const lod = new THREE.LOD();

  // Low LOD: 1500 stars, dimmer, smaller size (for dist > 100)
  const lowPositions = new Float32Array(1500 * 3);
  const lowColors = new Float32Array(1500 * 3);
  for (let i = 0; i < 1500; i++) {
    const seed = seededRandom(i * 1000);
    const distance = 50 + seed * 200;
    const theta = Math.acos(2 * seededRandom(i * 2000) - 1);
    const phi = seededRandom(i * 3000) * Math.PI * 2;

    const x = distance * Math.sin(theta) * Math.cos(phi);
    const y = distance * Math.sin(theta) * Math.sin(phi);
    const z = distance * Math.cos(theta);

    lowPositions[i * 3] = x;
    lowPositions[i * 3 + 1] = y;
    lowPositions[i * 3 + 2] = z;

    const brightness = 0.1 + Math.pow(seededRandom(i * 4000), 2) * 0.4; // Dimmer
    lowColors[i * 3] = brightness;
    lowColors[i * 3 + 1] = brightness;
    lowColors[i * 3 + 2] = brightness;
  }
  const lowGeometry = new THREE.BufferGeometry();
  lowGeometry.setAttribute('position', new THREE.BufferAttribute(lowPositions, 3));
  lowGeometry.setAttribute('color', new THREE.BufferAttribute(lowColors, 3));
  const lowMaterial = new THREE.PointsMaterial({
    vertexColors: true,
    size: 1.0, // Smaller
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending
  });
  const lowPoints = new THREE.Points(lowGeometry, lowMaterial);
  lod.addLevel(lowPoints, 100); // Visible beyond 100 units

  // Medium LOD: 4000 stars (for dist > 50)
  const medPositions = new Float32Array(4000 * 3);
  const medColors = new Float32Array(4000 * 3);
  for (let i = 0; i < 4000; i++) {
    const seed = seededRandom(i * 1000);
    const distance = 50 + seed * 150;
    const theta = Math.acos(2 * seededRandom(i * 2000) - 1);
    const phi = seededRandom(i * 3000) * Math.PI * 2;

    const x = distance * Math.sin(theta) * Math.cos(phi);
    const y = distance * Math.sin(theta) * Math.sin(phi);
    const z = distance * Math.cos(theta);

    medPositions[i * 3] = x;
    medPositions[i * 3 + 1] = y;
    medPositions[i * 3 + 2] = z;

    const brightness = 0.15 + Math.pow(seededRandom(i * 4000), 2) * 0.6;
    medColors[i * 3] = brightness;
    medColors[i * 3 + 1] = brightness;
    medColors[i * 3 + 2] = brightness;
  }
  const medGeometry = new THREE.BufferGeometry();
  medGeometry.setAttribute('position', new THREE.BufferAttribute(medPositions, 3));
  medGeometry.setAttribute('color', new THREE.BufferAttribute(medColors, 3));
  const medMaterial = new THREE.PointsMaterial({
    vertexColors: true,
    size: 1.5,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending
  });
  const medPoints = new THREE.Points(medGeometry, medMaterial);
  lod.addLevel(medPoints, 50); // Visible beyond 50 units

  // High LOD: 8000 stars, full detail (close-up)
  const highPositions = new Float32Array(maxStars * 3);
  const highColors = new Float32Array(maxStars * 3);
  for (let i = 0; i < maxStars; i++) {
    const seed = seededRandom(i * 1000);
    const distance = 50 + seed * 200;
    const theta = Math.acos(2 * seededRandom(i * 2000) - 1);
    const phi = seededRandom(i * 3000) * Math.PI * 2;

    const x = distance * Math.sin(theta) * Math.cos(phi);
    const y = distance * Math.sin(theta) * Math.sin(phi);
    const z = distance * Math.cos(theta);

    highPositions[i * 3] = x;
    highPositions[i * 3 + 1] = y;
    highPositions[i * 3 + 2] = z;

    const distanceFactor = Math.max(0.1, 1.0 - Math.log10(distance + 1) * 0.1);
    const brightness = 0.2 + Math.pow(seededRandom(i * 4000), 2) * 0.8 * distanceFactor;
    highColors[i * 3] = brightness;
    highColors[i * 3 + 1] = brightness;
    highColors[i * 3 + 2] = brightness;
  }
  const highGeometry = new THREE.BufferGeometry();
  highGeometry.setAttribute('position', new THREE.BufferAttribute(highPositions, 3));
  highGeometry.setAttribute('color', new THREE.BufferAttribute(highColors, 3));
  const highMaterial = new THREE.PointsMaterial({
    vertexColors: true,
    size: 2.0,
    transparent: true,
    opacity: 1.0,
    blending: THREE.AdditiveBlending
  });
  const highPoints = new THREE.Points(highGeometry, highMaterial);
  lod.addLevel(highPoints, 0); // Always for close range

  currentStarCount = 1500; // Start with low
  return lod;
}

function updateStarField(): void {
  if (!starField) return;

  // Add rotation to star field for subtle motion
  starFieldRotation += rotationSpeed;
  starField.rotation.y = starFieldRotation;

  // Update LOD based on camera distance to center
  const distToCenter = camera.position.distanceTo(new THREE.Vector3(0, 0, 0));
  (starField as THREE.LOD).update(camera);

  // Optional: Adjust currentStarCount for logging or future expansion, but LOD handles visibility
  const cameraDistance = camera.position.length();
  if (cameraDistance > lastCameraDistance + 100) {
    currentStarCount = Math.min(maxStars, currentStarCount + (cameraDistance - lastCameraDistance) * 2);
    lastCameraDistance = cameraDistance;
  }
}

function init(): void {
  // Create scene
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x000011) // Very dark blue for space

  // Create camera with natural initial viewing distance for comfortable black hole framing
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
  // Set camera position: farther back on mobile for better framing
  const isMobile = window.innerWidth < 768
  const cameraZ = isMobile ? 25 : 15 // Increased distance on mobile for better framing
  camera.position.set(0, isMobile ? 6 : 4, cameraZ) // Adjust Y position for better angle on mobile

  // Get canvas element
  const canvas = document.getElementById('canvas') as HTMLCanvasElement

  // Create renderer with mobile optimizations
  const context = canvas.getContext('webgl', {
    alpha: false,
    antialias: window.devicePixelRatio <= 1, // Disable antialiasing on high-DPI for performance
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
    stencil: false
  })

  if (!context) {
    throw new Error('WebGL not supported')
  }

  renderer = new THREE.WebGLRenderer({
    canvas,
    context,
    antialias: window.devicePixelRatio <= 1
  })

  const isWebGL2 = renderer.capabilities.isWebGL2;
  if (!isWebGL2) {
    console.warn('WebGL2 not supported; falling back to CPU physics for particles');
  }

  // Mobile-responsive sizing
  const updateSize = () => {
    const width = window.innerWidth
    const height = window.innerHeight

    // Handle dynamic viewport changes on mobile (address bar, etc.)
    canvas.width = width * window.devicePixelRatio
    canvas.height = height * window.devicePixelRatio
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    renderer.setSize(width, height, false) // false = don't update style
  }

  updateSize()
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)) // Cap at 2 for performance
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace // Better color accuracy

  // Create post-processing composer
  composer = new EffectComposer(renderer)
  const renderPass = new RenderPass(scene, camera)
  composer.addPass(renderPass)

  // Gravitational lensing pass (enhanced ray-marched)
  const lensingShader = {
    uniforms: {
      tDiffuse: { value: null },
      resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      rs: { value: 1.4 }, // Schwarzschild radius
      center: { value: new THREE.Vector2(0.5, 0.5) },
      cameraPosition: { value: new THREE.Vector3() } // For 3D ray casting
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform vec2 resolution;
      uniform float rs;
      uniform vec2 center;
      uniform vec3 cameraPosition;
      varying vec2 vUv;

      void main() {
        vec2 uv = vUv;
        vec2 screenCenter = center * resolution;
        vec2 rayDir2D = (uv * resolution - screenCenter) / resolution.y; // Normalized direction
        vec3 rayDir = normalize(vec3(rayDir2D, -1.0)); // Assume forward z
        vec3 rayPos = cameraPosition;

        // Simple ray-march for bending (8 steps)
        float stepSize = 0.1;
        vec3 bentRay = rayDir;
        for (int i = 0; i < 8; i++) {
          vec3 toBH = vec3(center * resolution - gl_FragCoord.xy, 0.0) / resolution.y;
          float b = length(cross(bentRay, toBH)); // Impact parameter
          float deflection = 1.5 * rs / b; // Approx deflection angle
          bentRay = normalize(bentRay + deflection * normalize(toBH));
          rayPos += bentRay * stepSize;
        }

        // Sample at bent position (project back to UV)
        vec2 lensedUV = uv + rayDir2D * (1.0 + 0.5 * rs / length(rayDir2D + 0.01));
        lensedUV = clamp(lensedUV, 0.0, 1.0);

        vec4 color = texture2D(tDiffuse, lensedUV);
        gl_FragColor = color;
      }
    `
  };
  const lensingPass = new ShaderPass(lensingShader);
  composer.addPass(lensingPass);

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.8, // strength (reduced for better core visibility)
    0.3, // radius (tighter for less core washing)
    0.92 // threshold (higher to preserve core darkness)
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
  if (isWebGL2 && gpuComputeDisk) {
    const time = performance.now() * 0.001;
    positionVariableDisk.material.uniforms['time'].value = time;
    velocityVariableDisk.material.uniforms['time'].value = time;

    gpuComputeDisk.compute();
    gpuComputeDisk.doRenderTargetReadout(positionVariableDisk.texture);

    // Update geometry from position texture
    const posArray = positionVariableDisk.texture.image.data as Float32Array;
    const positions = accretionDisk.geometry.attributes.position.array as Float32Array;
    const particleCount = 2000;
    for (let i = 0; i < particleCount; i++) {
      const idx = i * 4;
      positions[i * 3] = posArray[idx];
      positions[i * 3 + 1] = posArray[idx + 1];
      positions[i * 3 + 2] = posArray[idx + 2];
    }
    accretionDisk.geometry.attributes.position.needsUpdate = true;
  } else if (!isWebGL2) {
    // Fallback CPU physics (position-only, approximate)
    const positions = accretionDisk.geometry.attributes.position;
    const particleCount = 2000;
    for (let i = 0; i < particleCount; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      const y = positions.getY(i);

      const distance = Math.sqrt(x * x + z * z);
      if (distance > 0) {
        const gravityStrength = 0.0001 / (distance * distance);
        const accelX = -gravityStrength * (x / distance) * 0.016;
        const accelZ = -gravityStrength * (z / distance) * 0.016;

        // Approximate velocity integration (Euler)
        positions.setX(i, x + accelX);
        positions.setZ(i, z + accelZ);
      }

      // Turbulence
      positions.setY(i, y + (Math.random() - 0.5) * 0.005);
      positions.setX(i, positions.getX(i) + (Math.random() - 0.5) * 0.002);
      positions.setZ(i, positions.getZ(i) + (Math.random() - 0.5) * 0.002);

      // Reset
      const distance = Math.sqrt(positions.getX(i) * positions.getX(i) + positions.getZ(i) * positions.getZ(i));
      if (distance < 1.5 || distance > 7) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 2.5 + Math.random() * 2;
        positions.setX(i, Math.cos(angle) * radius);
        positions.setZ(i, Math.sin(angle) * radius);
        positions.setY(i, (Math.random() - 0.5) * 0.3);
      }
    }
    positions.needsUpdate = true;
  }
}

function animateJetPhysics(): void {
  if (isWebGL2 && gpuComputeJets) {
    const time = performance.now() * 0.001;
    positionVariableJets.material.uniforms['time'].value = time;
    velocityVariableJets.material.uniforms['time'].value = time;

    gpuComputeJets.compute();
    gpuComputeJets.doRenderTargetReadout(positionVariableJets.texture);

    // Update geometry
    const posArray = positionVariableJets.texture.image.data as Float32Array;
    const positions = jetStreams.geometry.attributes.position.array as Float32Array;
    const particleCount = 1000;
    for (let i = 0; i < particleCount; i++) {
      const idx = i * 4;
      positions[i * 3] = posArray[idx];
      positions[i * 3 + 1] = posArray[idx + 1];
      positions[i * 3 + 2] = posArray[idx + 2];
    }
    jetStreams.geometry.attributes.position.needsUpdate = true;
  } else if (!isWebGL2) {
    // Fallback CPU physics (position-only)
    const positions = jetStreams.geometry.attributes.position;
    const particleCount = 1000;
    for (let i = 0; i < particleCount; i++) {
      let y = positions.getY(i);
      const pole = y > 0 ? 1 : -1;

      // Approximate acceleration
      y += pole * 0.001 * 0.016; // dt

      if (Math.abs(y) > 10) {
        y = pole * 2;
      }
      positions.setY(i, y);
    }
    positions.needsUpdate = true;
  }
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

  // Update lensing camera position
  lensingPass.uniforms.cameraPosition.value.copy(camera.position);

  composer.render()
}

function onWindowResize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  composer.setSize(width, height);

  // Update lensing and bloom resolution
  lensingPass.uniforms.resolution.value.set(width, height);
  bloomPass.resolution.set(width, height);
}

init()
