import * as THREE from "three"

/** Size (in world units) of the square ground plane and the grid overlay. */
export const GROUND_PLANE_SIZE = 500

/**
 * Procedurally generates the noise-textured grass ground plane.
 * Returns the mesh laid flat and ready to add to a scene (does not add it).
 */
export function createGround(): THREE.Mesh {
	const size = GROUND_PLANE_SIZE
	const baseColor = { r: 8, g: 20, b: 9 } // corresponds to 0x2c7037

	// Set the desaturation factor (0 = no desaturation, 1 = fully grayscale)
	const desaturationFactor = 0.2
	const darkenFactor = 1 // Multiply the grayscale value to darken it

	// Create a low-resolution canvas to generate large, subtle noise
	const noiseCanvas = document.createElement("canvas")
	noiseCanvas.width = 64 // Low resolution for large noise blocks
	noiseCanvas.height = 64
	const noiseContext = noiseCanvas.getContext("2d")
	if (!noiseContext) {
		throw new Error("Failed to create canvas context for noise")
	}

	const noiseImageData = noiseContext.createImageData(
		noiseCanvas.width,
		noiseCanvas.height
	)
	const noiseData = noiseImageData.data

	// Loop through each pixel and add a slight random offset to the base color
	for (let y = 0; y < noiseCanvas.height; y++) {
		for (let x = 0; x < noiseCanvas.width; x++) {
			const index = (y * noiseCanvas.width + x) * 4
			// Generate a noise value between -15 and 15 for subtle variation
			const noiseVal = Math.random() * 4 - 10

			// Apply the noise to each channel
			let r = baseColor.r + 2 * noiseVal
			let g = baseColor.g + noiseVal
			let b = baseColor.b + noiseVal

			// Clamp the values to valid [0, 255] range
			r = Math.min(255, Math.max(0, r))
			g = Math.min(255, Math.max(0, g))
			b = Math.min(255, Math.max(0, b))

			// Compute the grayscale value using the luminosity method
			const gray = r * 0.299 + g * 0.587 + b * 0.114
			const darkGray = gray * darkenFactor
			// Blend the original color with the grayscale based on the desaturation factor
			r = r * (1 - desaturationFactor) + darkGray * desaturationFactor
			g = g * (1 - desaturationFactor) + darkGray * desaturationFactor
			b = b * (1 - desaturationFactor) + darkGray * desaturationFactor

			// Final clamp just in case
			noiseData[index] = Math.min(255, Math.max(0, r))
			noiseData[index + 1] = Math.min(255, Math.max(0, g))
			noiseData[index + 2] = Math.min(255, Math.max(0, b))
			noiseData[index + 3] = 255 // Fully opaque
		}
	}

	// Draw the generated noise data onto the canvas
	noiseContext.putImageData(noiseImageData, 0, 0)

	// Create a texture from the canvas
	const noiseTexture = new THREE.CanvasTexture(noiseCanvas)
	// Set the texture to repeat so it covers the entire plane
	noiseTexture.wrapS = THREE.RepeatWrapping
	noiseTexture.wrapT = THREE.RepeatWrapping
	noiseTexture.repeat.set(
		size / noiseCanvas.width,
		size / noiseCanvas.height
	)

	// Use NearestFilter to keep the blocky noise effect
	noiseTexture.minFilter = THREE.NearestFilter
	noiseTexture.magFilter = THREE.NearestFilter

	const planeGeometry = new THREE.PlaneGeometry(size, size)
	const planeMaterial = new THREE.MeshLambertMaterial({
		map: noiseTexture,
		side: THREE.DoubleSide,
	})

	// Create the mesh and rotate it to lay flat
	const ground = new THREE.Mesh(planeGeometry, planeMaterial)
	ground.rotation.x = -Math.PI / 2
	ground.receiveShadow = true
	return ground
}

/**
 * Builds the lighting rig: a (currently disabled) ambient light plus three
 * shadow-casting directional lights. Returns the lights ready to add to a scene.
 */
export function createLights(): THREE.Light[] {
	const lights = [
		new THREE.AmbientLight(0xffffff, 0),
		new THREE.DirectionalLight(0xffffff, 3),
		new THREE.DirectionalLight(0xffffff, 0.5),
		new THREE.DirectionalLight(0xffffff, 0.2),
	]

	const d = 200
	lights[1].position.set(1 * d, 1 * d, -1 * d)
	lights[2].position.set(1 * d, 1 * d, 0)
	lights[3].position.set(0, 1 * d, 1 * d)

	lights.forEach((light) => {
		if (light instanceof THREE.DirectionalLight) {
			light.castShadow = true
			light.shadow.mapSize.width = 2048 * 3
			light.shadow.mapSize.height = 2048 * 3

			light.shadow.camera.left = -d
			light.shadow.camera.right = d
			light.shadow.camera.top = d
			light.shadow.camera.bottom = -d
			light.shadow.camera.near = 0.1
			light.shadow.camera.far = 500
			light.shadow.camera.updateProjectionMatrix()
		}
	})

	return lights
}
