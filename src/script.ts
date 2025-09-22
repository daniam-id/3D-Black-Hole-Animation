import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'

let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let controls: OrbitControls
let blackHole: THREE.Mesh
let accretionDisk: THREE.Points

function createBlackHole(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(1.5, 64, 32)
  const material = new THREE.MeshBasicMaterial({ color: 0x000000 })
  const mesh = new THREE.Mesh(geometry, material)
  return mesh
}

function createAccretionDisk(): THREE.Points {
  const particleCount = 2000
  const positions = new Float32Array(particleCount * 3)
  const colors = new Float32Array(particleCount * 3)

  for (let i = 0; i < particleCount; i++) {
    const angle = Math.random() * Math.PI * 2
    const radius = 2 + Math.random() * 2 // between 2 and 4
    const height = (Math.random() - 0.5) * 0.3 // small height variation

    positions[i * 3] = Math.cos(angle) * radius
    positions[i * 3 + 1] = height
    positions[i * 3 + 2] = Math.sin(angle) * radius

    // Color gradient from orange to red
    colors[i * 3] = Math.random() * 0.5 + 0.5 // red
    colors[i * 3 + 1] = Math.random() * 0.3 + 0.2 // green
    colors[i * 3 + 2] = 0 // blue
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

  const material = new THREE.PointsMaterial({ 
    vertexColors: true, 
    size: 0.03,
    transparent: true,
    opacity: 0.8
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

function animate(): void {
  requestAnimationFrame(animate)
  controls.update()
  accretionDisk.rotation.y += 0.005
  renderer.render(scene, camera)
}

function onWindowResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
}

init()
