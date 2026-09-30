// WebGPU renderer + physically based post-processing pipeline.
// Screen-space ray-marched reflections (SSR), screen-space global illumination (SSGI),
// bloom and temporal reprojection AA (TRAA). Falls back to WebGL2 when WebGPU is missing.
import * as THREE from 'three/webgpu';
import {
	pass, mrt, output, normalView, diffuseColor, velocity, metalness, roughness,
	vec2, vec4, float, uniform, packNormalToRGB, unpackRGBToNormal, sample,
	screenUV, smoothstep, renderOutput
} from 'three/tsl';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';

export const QUALITY = {
	ultra: { label: 'Ультра', maxDpr: 1.25, ssgi: true, slices: 2, steps: 10, ssr: true, ssrQuality: 0.6, ssrScale: 1, bloom: true, taa: true },
	high: { label: 'Высокая', maxDpr: 1.0, ssgi: true, slices: 1, steps: 8, ssr: true, ssrQuality: 0.45, ssrScale: 0.5, bloom: true, taa: true },
	medium: { label: 'Средняя', maxDpr: 1.0, ssgi: false, ssr: true, ssrQuality: 0.3, ssrScale: 0.5, bloom: true, taa: false },
	low: { label: 'Низкая', maxDpr: 0.85, ssgi: false, ssr: false, bloom: true, taa: false }
};

export class GameRenderer {

	constructor( container ) {

		this.container = container;
		this.quality = 'ultra';
		this.pipeline = null;
		this.dprScale = 1;
		this.frameTimes = [];
		this.vignette = uniform( 0.35 );
		this.tint = uniform( new THREE.Color( 1, 1, 1 ) );
		this.gpuName = '';

	}

	async init( { forceWebGL = false } = {} ) {

		const r = new THREE.WebGPURenderer( { antialias: false, forceWebGL, powerPreference: 'high-performance' } );
		r.setPixelRatio( Math.min( window.devicePixelRatio, 1.5 ) );
		r.setSize( window.innerWidth, window.innerHeight );
		r.toneMapping = THREE.ACESFilmicToneMapping;
		r.toneMappingExposure = 1.0;
		r.outputColorSpace = THREE.SRGBColorSpace;
		this.container.appendChild( r.domElement );
		// safety net: if the WebGPU device reports validation failures or is lost, fall back to WebGL 2
		this.gpuErrors = 0;
		THREE.setConsoleFunction( ( type, message, ...rest ) => {

			if ( type === 'error' && this.isWebGPU && /GPUValidationError|pipeline creation failed|WGSL|Device Lost/i.test( String( message ) ) ) {

				this.gpuErrors ++;
				if ( this.gpuErrors >= 3 ) this.onWebGPUFailure?.( String( message ) );

			}

			( console[ type ] || console.log )( message, ...rest );

		} );
		r.onDeviceLost = ( info ) => { console.error( 'WebGPU device lost', info?.message ); if ( this.isWebGPU ) this.onWebGPUFailure?.( info?.message || 'device lost' ); };
		await r.init();
		this.renderer = r;
		this.isWebGPU = !! r.backend.isWebGPUBackend;

		try {

			const info = r.backend.adapter?.info;
			if ( info ) this.gpuName = [ info.vendor, info.architecture, info.description || info.device ].filter( Boolean ).join( ' · ' );

		} catch ( e ) { /* not critical */ }

		if ( ! this.gpuName && ! this.isWebGPU ) {

			try {

				const gl = r.backend.gl;
				const ext = gl.getExtension( 'WEBGL_debug_renderer_info' );
				if ( ext ) this.gpuName = gl.getParameter( ext.UNMASKED_RENDERER_WEBGL );

			} catch ( e ) { /* ignore */ }

		}

		window.addEventListener( 'resize', () => this.resize() );
		return r;

	}

	setScene( scene, camera ) {

		this.scene = scene;
		this.camera = camera;
		this.buildPipeline();

	}

	setQuality( q ) {

		if ( ! QUALITY[ q ] ) q = 'high';
		this.quality = q;
		this.dprScale = 1;
		this.resize();
		if ( this.scene ) this.buildPipeline();

	}

	get preset() { return QUALITY[ this.quality ]; }

	buildPipeline() {

		const Q = this.preset;
		const { scene, camera, renderer } = this;

		if ( this.pipeline ) this.pipeline.dispose?.();

		const pipeline = new THREE.RenderPipeline( renderer );
		const scenePass = pass( scene, camera );

		const outputs = { output };
		if ( Q.ssgi ) outputs.diffuseColor = diffuseColor;
		if ( Q.ssgi || Q.ssr ) outputs.normal = packNormalToRGB( normalView );
		if ( Q.ssr ) outputs.metalrough = vec2( metalness, roughness );
		if ( Q.taa ) outputs.velocity = velocity;
		scenePass.setMRT( mrt( outputs ) );

		const col = scenePass.getTextureNode( 'output' );
		const depth = scenePass.getTextureNode( 'depth' );
		let sceneNormal = null;

		if ( outputs.normal ) {

			scenePass.getTexture( 'normal' ).type = THREE.UnsignedByteType;
			const nrm = scenePass.getTextureNode( 'normal' );
			sceneNormal = sample( ( uv ) => unpackRGBToNormal( nrm.sample( uv ) ) );

		}

		if ( outputs.diffuseColor ) scenePass.getTexture( 'diffuseColor' ).type = THREE.UnsignedByteType;
		if ( outputs.metalrough ) scenePass.getTexture( 'metalrough' ).type = THREE.UnsignedByteType;

		let color = col;

		if ( Q.ssgi ) {

			const gi = ssgi( col, depth, sceneNormal, camera );
			gi.sliceCount.value = Q.slices;
			gi.stepCount.value = Q.steps;
			gi.radius.value = 6;
			gi.thickness.value = 0.6;
			gi.aoIntensity.value = 1.15;
			gi.giIntensity.value = 3.0;
			gi.useTemporalFiltering = Q.taa;
			this.ssgiNode = gi;
			const dif = scenePass.getTextureNode( 'diffuseColor' );
			color = vec4( col.rgb.mul( gi.getAONode() ).add( dif.rgb.mul( gi.getGINode().rgb ) ), col.a );

		}

		if ( Q.ssr ) {

			const mr = scenePass.getTextureNode( 'metalrough' );
			const s = ssr( col, depth, sceneNormal, {
				metalnessNode: mr.r,
				roughnessNode: mr.g,
				reflectNonMetals: true,
				camera
			} );
			s.maxDistance.value = 28;
			s.thickness.value = 0.25;
			s.quality.value = Q.ssrQuality;
			s.intensity.value = 1.0;
			s.resolutionScale = Q.ssrScale;
			this.ssrNode = s;
			color = color.add( vec4( s.rgb, 0 ) );

		}

		if ( Q.bloom ) {

			const b = bloom( color, Q.ssgi ? 0.4 : 0.3, 0.4, 1.35 );
			this.bloomNode = b;
			color = color.add( b );

		}

		// cinematic vignette + global tint (used for damage / emergency lighting)
		const d = screenUV.sub( 0.5 ).length();
		const vig = float( 1 ).sub( smoothstep( 0.35, 0.95, d ).mul( this.vignette ) );
		color = vec4( color.rgb.mul( vig ).mul( this.tint ), 1 );

		if ( Q.taa ) {

			const vel = scenePass.getTextureNode( 'velocity' );
			pipeline.outputNode = traa( color, depth, vel, camera );

		} else {

			pipeline.outputColorTransform = false;
			pipeline.outputNode = fxaa( renderOutput( color ) );

		}

		this.pipeline = pipeline;
		this.scenePass = scenePass;

	}

	resize() {

		const Q = this.preset;
		const dpr = Math.min( window.devicePixelRatio, Q.maxDpr ) * this.dprScale;
		this.renderer.setPixelRatio( dpr );
		this.renderer.setSize( window.innerWidth, window.innerHeight );
		if ( this.camera ) {

			this.camera.aspect = window.innerWidth / window.innerHeight;
			this.camera.updateProjectionMatrix();

		}

	}

	// dynamic resolution: keeps the frame rate high on heavy scenes
	adapt( dt ) {

		this.frameTimes.push( dt );
		if ( this.frameTimes.length < 90 ) return;
		const avg = this.frameTimes.reduce( ( a, b ) => a + b, 0 ) / this.frameTimes.length;
		this.frameTimes.length = 0;
		let s = this.dprScale;
		if ( avg > 1 / 50 && s > 0.6 ) s = Math.max( 0.6, s - 0.1 );
		else if ( avg < 1 / 90 && s < 1 ) s = Math.min( 1, s + 0.05 );
		if ( s !== this.dprScale ) {

			this.dprScale = s;
			this.resize();

		}

	}

	render() {

		this.pipeline.render();

	}

}
