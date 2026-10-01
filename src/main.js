// «Последний поезд» — FPS in the Moscow metro. Game bootstrap, wave director and station travel.
import * as THREE from 'three/webgpu';
import { GameRenderer } from './core/renderer.js';
import { ctx } from './core/ctx.js';
import { Input } from './core/input.js';
import { AudioEngine } from './core/audio.js';
import { Voice } from './core/voice.js';
import { LightPool, StationWorld } from './world/world.js';
import { buildInfrastructure, addInfrastructureCollision } from './world/stations/common.js';
import { buildStation } from './world/stations/index.js';
import { STATIONS } from './world/layout.js';
import { Train } from './world/train.js';
import { FX } from './fx/fx.js';
import { Player } from './player/player.js';
import { Weapons } from './player/weapons.js';
import { Enemies, TYPES } from './enemies/enemies.js';
import { HUD } from './ui/hud.js';

const params = new URLSearchParams( location.search );
const $ = ( id ) => document.getElementById( id );

function setLoading( p, text ) {

	$( 'loading' ).querySelector( '.fill' ).style.width = ( p * 100 ).toFixed( 0 ) + '%';
	if ( text ) $( 'loading' ).querySelector( '.txt' ).textContent = text;

}

const nextFrame = () => new Promise( ( r ) => requestAnimationFrame( () => setTimeout( r, 0 ) ) );

class Game {

	constructor() {

		this.state = 'menu';
		this.wave = 0;
		this.stationIndex = 0;
		this.score = 0;
		this.god = params.has( 'god' );
		this.paused = true;
		this.started = false;
		this.stationsVisited = 0;
		this.lampsBroken = 0;
		this.time0 = 0;

	}

	async init() {

		ctx.game = this;
		setLoading( 0.05, 'Инициализация WebGPU…' );
		const gr = new GameRenderer( $( 'app' ) );
		gr.onWebGPUFailure = ( msg ) => {

			if ( this.fellBack || params.has( 'webgl' ) ) return;
			this.fellBack = true;
			// step down the effects first (most likely culprit), WebGL 2 only as the last resort
			const order = [ 'ultra', 'high', 'medium', 'low' ];
			const cur = order.indexOf( gr.quality );
			const next = cur >= 0 && cur < order.length - 1 ? order[ cur + 1 ] : null;
			let log = '';
			try { log = sessionStorage.getItem( 'metro-webgpu-log' ) || ''; } catch ( e ) { /* ignore */ }
			log += `[${ gr.quality }] ${ msg }\n`;
			try { sessionStorage.setItem( 'metro-webgpu-log', log ); sessionStorage.setItem( 'metro-webgpu-error', String( msg ).slice( 0, 500 ) ); } catch ( e ) { /* ignore */ }
			console.error( 'WebGPU failure log:\n' + log );
			const el = $( 'error' );
			el.textContent = 'WebGPU сообщил об ошибке:\n' + msg + '\n\n' + ( next ? `Перезапуск на WebGPU с качеством «${ next }»…` : 'Перезапуск в режиме WebGL 2…' );
			el.classList.remove( 'hidden' );
			setTimeout( () => {

				const u = new URL( location.href );
				if ( next ) u.searchParams.set( 'q', next ); else u.searchParams.set( 'webgl', '1' );
				location.href = u.toString();

			}, 2500 );

		};
		await gr.init( { forceWebGL: params.has( 'webgl' ) } );
		this.gr = gr;
		ctx.renderer = gr;
		const scene = new THREE.Scene();
		scene.background = new THREE.Color( 0x020202 );
		const camera = new THREE.PerspectiveCamera( 78, innerWidth / innerHeight, 0.05, 700 );
		scene.add( camera );
		ctx.scene = scene; ctx.camera = camera;
		this.scene = scene; this.camera = camera;
		const saved = this.loadSettings();
		gr.quality = params.get( 'q' ) || saved.quality || ( gr.isWebGPU ? 'ultra' : 'medium' );
		$( 'quality' ).value = gr.quality;
		let why = '', wlog = '';
		try { why = sessionStorage.getItem( 'metro-webgpu-error' ) || ''; wlog = sessionStorage.getItem( 'metro-webgpu-log' ) || ''; } catch ( e ) { /* ignore */ }
		if ( wlog && gr.isWebGPU ) why = '';
		const gpuMode = gr.isWebGPU ? 'WebGPU' : params.has( 'webgl' ) ? ( why ? `WebGL 2 (WebGPU отключён после ошибки: ${ why })` : 'WebGL 2 (выбран вручную)' ) : 'WebGL 2 (WebGPU недоступен в браузере)';
		if ( wlog ) $( 'gpuinfo' ).title = wlog;
		if ( wlog ) console.warn( 'Предыдущие ошибки WebGPU:\n' + wlog );
		$( 'gpuinfo' ).textContent = ( wlog ? 'Журнал WebGPU: ' + wlog.replace( /\n/g, ' | ' ) + ' — ' : '' ) + `${ gpuMode }${ gr.gpuName ? ' · ' + gr.gpuName : '' } · three.js r${ THREE.REVISION }`;

		setLoading( 0.12, 'Прокладываем тоннели…' );
		await nextFrame();
		this.pool = new LightPool( scene, 14 );
		this.infra = buildInfrastructure();
		scene.add( this.infra.group );
		ctx.infra = this.infra;
		this.hemi = new THREE.HemisphereLight( 0xffffff, 0x222222, 0.1 );
		scene.add( this.hemi );
		// fixed extra lights: muzzle flashes & flashlight (light count never changes → no shader recompiles)
		const flash = [ new THREE.PointLight( 0xffb060, 0, 14, 2 ) ];
		flash.forEach( ( l ) => scene.add( l ) );
		this.flashlight = new THREE.SpotLight( 0xfff6e6, 0, 45, 0.38, 0.45, 1.4 );
		camera.add( this.flashlight );
		this.flashlight.position.set( 0.15, - 0.1, 0 );
		camera.add( this.flashlight.target );
		this.flashlight.target.position.set( 0.1, - 0.1, - 5 );
		// soft fill light for the first-person weapon (tiny radius: it barely touches the world)
		const vmFill = new THREE.PointLight( 0xfff0e0, 0.35, 1.6, 2 );
		vmFill.position.set( 0.05, 0.25, 0.05 );
		camera.add( vmFill );

		setLoading( 0.2, 'Оружие и эффекты…' );
		await nextFrame();
		this.fx = new FX( scene );
		this.fx.setFlashLights( flash );
		ctx.fx = this.fx;
		this.audio = new AudioEngine();
		this.audio.setVolume( saved.vol ?? 0.8 );
		ctx.audio = this.audio;
		this.voice = new Voice();
		this.voice.enabled = saved.voices ?? true;
		ctx.voice = this.voice;
		this.hud = new HUD();
		ctx.hud = this.hud;
		this.input = new Input( gr.renderer.domElement );
		this.player = new Player( camera );
		this.player.sens = 0.0022 * ( saved.sens ?? 1 );
		this.player.baseFov = saved.fov ?? 78;
		ctx.player = this.player;
		this.weapons = new Weapons( camera );
		ctx.weapons = this.weapons;
		this.enemies = new Enemies( scene );
		ctx.enemies = this.enemies;
		setLoading( 0.35, 'Поезд «Москва-2020» выходит из депо…' );
		await nextFrame();
		this.train = new Train( scene, 7 );
		ctx.train = this.train;
		this.train.onEvent = ( e ) => this.onTrainEvent( e );
		this.train.hide();

		const startStation = STATIONS.findIndex( ( s ) => s.id === params.get( 'station' ) );
		this.stationIndex = startStation >= 0 ? startStation : 0;
		setLoading( 0.5, 'Строим станцию «' + STATIONS[ this.stationIndex ].name + '»…' );
		await nextFrame();
		this.loadStation( this.stationIndex );
		gr.setScene( scene, camera );
		setLoading( 0.8, 'Компиляция шейдеров…' );
		await nextFrame();
		// pre-warm: every outfit, enemy gun and the train are compiled now instead of stuttering later
		const { Femme, OUTFITS } = await import( './enemies/femmeModel.js' );
		const { buildEnemyGun } = await import( './player/weaponModels.js' );
		const warm = new THREE.Group();
		Object.keys( OUTFITS ).forEach( ( k, i ) => { const f = new Femme( k ); f.root.position.set( - 8 - i, 0, 3 ); warm.add( f.root ); } );
		[ 'pistol', 'smg', 'shotgun' ].forEach( ( k, i ) => { const g = buildEnemyGun( k ); g.position.set( - 8 - i, 1, 2 ); warm.add( g ); } );
		scene.add( warm );
		this.train.group.visible = true;
		this.train.x = - 20; this.train.group.position.x = - 20;
		this.player.spawn( - 6, 0, - Math.PI / 2 );
		this.player.update( 0.016, this.input );
		try {

			// compile scene materials for the MRT pass in parallel (never block loading forever)
			await Promise.race( [ gr.scenePass.compileAsync( gr.renderer ), new Promise( ( r ) => setTimeout( r, 20000 ) ) ] );
			gr.render();

		} catch ( e ) { console.warn( e ); }

		scene.remove( warm );
		this.train.hide();
		setLoading( 1, 'Готово' );
		this.bindUI();
		this.player.spawn( - 6, 0, - Math.PI / 2 );
		this.player.update( 0.016, this.input );
		this.last = performance.now();
		this.fpsAcc = 0; this.fpsN = 0; this.fpsShow = '';
		gr.renderer.setAnimationLoop( () => this.frame() );
		$( 'loading' ).classList.add( 'hidden' );
		$( 'play' ).classList.remove( 'hidden' );
		$( 'settings' ).classList.remove( 'hidden' );
		if ( params.has( 'autostart' ) ) this.start();

	}

	loadSettings() {

		try { return JSON.parse( localStorage.getItem( 'metro-settings' ) || '{}' ); } catch ( e ) { return {}; }

	}

	saveSettings() {

		try {

			localStorage.setItem( 'metro-settings', JSON.stringify( {
				quality: $( 'quality' ).value, sens: + $( 'sens' ).value, fov: + $( 'fov' ).value, vol: + $( 'vol' ).value, voices: $( 'voices' ).checked
			} ) );

		} catch ( e ) { /* ignore */ }

	}

	bindUI() {

		const s = this.loadSettings();
		if ( s.sens ) $( 'sens' ).value = s.sens;
		if ( s.fov ) $( 'fov' ).value = s.fov;
		if ( s.vol !== undefined ) $( 'vol' ).value = s.vol;
		if ( s.voices !== undefined ) $( 'voices' ).checked = s.voices;
		$( 'play' ).onclick = () => this.start();
		$( 'restart' ).onclick = () => this.restart();
		$( 'quality' ).onchange = ( e ) => { this.gr.setQuality( e.target.value ); this.saveSettings(); };
		$( 'sens' ).oninput = ( e ) => { this.player.sens = 0.0022 * + e.target.value; this.saveSettings(); };
		$( 'fov' ).oninput = ( e ) => { this.player.baseFov = + e.target.value; this.saveSettings(); };
		$( 'vol' ).oninput = ( e ) => { this.audio.setVolume( + e.target.value ); this.saveSettings(); };
		$( 'voices' ).onchange = ( e ) => { this.voice.enabled = e.target.checked; this.saveSettings(); };
		this.input.onLockChange = ( locked ) => {

			if ( ! this.started || this.state === 'dead' || this.bot ) return;
			this.paused = ! locked;
			$( 'menu' ).classList.toggle( 'hidden', locked );
			$( 'menu' ).classList.add( 'overlay' );
			$( 'play' ).textContent = 'ПРОДОЛЖИТЬ';
			this.hud.show( locked );
			if ( ! locked ) this.voice.stop();

		};

	}

	async start() {

		this.input.lock(); // must run inside the click's user activation
		try { await this.audio.init(); } catch ( e ) { console.warn( 'audio', e ); }
		if ( ! this.started ) {

			this.started = true;
			this.time0 = performance.now();
			$( 'menu' ).classList.add( 'hidden' );
			this.hud.show( true );
			this.paused = false;
			const w = + params.get( 'wave' ) || 1;
			this.beginWave( w, true );

		} else {

			this.paused = false;
			$( 'menu' ).classList.add( 'hidden' );
			this.hud.show( true );

		}

	}

	// ------------------------------------------------------------------ stations

	loadStation( index ) {

		if ( ctx.world ) ctx.world.dispose();
		this.fx?.clear();
		const info = STATIONS[ index % STATIONS.length ];
		const W = new StationWorld( this.pool, info );
		const look = buildStation( W, info.id, { variant: Math.floor( index / STATIONS.length ) } );
		addInfrastructureCollision( W, this.infra );
		W.finalize();
		// later laps: the line has been fought over — dead bulbs, faulty flickering fixtures, thicker haze
		const lap = Math.floor( index / STATIONS.length );
		if ( lap > 0 ) {

			for ( const b of W.breakables ) {

				if ( ! b.bulbLocal ) continue;
				for ( let i = 0; i < b.bulbLocal.length; i ++ ) if ( Math.random() < Math.min( 0.45, 0.15 * lap ) ) b.preBreak( i );
				if ( Math.random() < 0.3 ) b.faulty = true;

			}

			look.fog = { color: look.fog.color, density: look.fog.density * ( 1 + 0.35 * lap ) };

		}
		this.scene.add( W.group );
		ctx.world = W;
		this.look = look;
		this.hemi.color.set( look.hemi.sky );
		this.hemi.groundColor.set( look.hemi.ground );
		this.hemi.intensity = look.hemi.intensity;
		this.scene.fog = new THREE.FogExp2( look.fog.color, look.fog.density );
		this.gr.renderer.toneMappingExposure = ( look.exposure ?? 1 ) * ( this.gr.preset.ssgi ? 1 : 0.82 );
		// the platform edge next to the train track
		this.edgeBox = W.colliders.boxes.find( ( b ) => b.tag === 'edge+' );
		W.colliders.dynamic = [ () => this.train.colliderBoxes() ];
		// reflections: pre-filtered environment captured from the middle of the hall
		const pm = new THREE.PMREMGenerator( this.gr.renderer );
		// capture architecture only: effects use per-material MRT outputs that don't exist in the cube target
		const hide = [ this.weapons?.root, this.train?.group, this.fx?.root ].filter( Boolean );
		const was = hide.map( ( o ) => o.visible );
		hide.forEach( ( o ) => { o.visible = false; } );
		// ping-pong between two targets: never render into the texture that is currently bound as scene.environment
		this.envRTs = this.envRTs || [ null, null ];
		this.envIdx = ( ( this.envIdx ?? 1 ) + 1 ) % 2;
		this.envRTs[ this.envIdx ] = pm.fromScene( this.scene, 0.02, 0.1, 250, { position: new THREE.Vector3( 0, 3.2, 0 ), size: 256, renderTarget: this.envRTs[ this.envIdx ] } );
		hide.forEach( ( o, i ) => { o.visible = was[ i ]; } );
		pm.dispose();
		this.scene.environment = this.envRTs[ this.envIdx ].texture;
		this.scene.environmentIntensity = look.envIntensity ?? 0.5;
		this.stationName = info.name;
		this.train.setDestination( STATIONS[ ( index + 1 ) % STATIONS.length ].name );
		return W;

	}

	// ------------------------------------------------------------------ waves

	waveConfig( n ) {

		const total = 4 + ( n - 1 ) * 3;
		const maxAlive = Math.min( 2 + n, 9 );
		const types = [];
		for ( let i = 0; i < total; i ++ ) {

			let t = 'glam';
			if ( n >= 2 && Math.random() < Math.min( 0.45, 0.2 + n * 0.05 ) ) t = 'agent';
			types.push( t );

		}

		if ( n >= 3 ) for ( let i = 0; i < Math.floor( ( n - 1 ) / 2 ); i ++ ) types[ types.length - 1 - i * 2 ] = 'boss';
		const k = n - 1;
		const easy = n === 1;
		return {
			total, maxAlive, types,
			gap: Math.max( 1.0, 3.2 - n * 0.3 ),
			stats: ( type ) => ( {
				hp: TYPES[ type ].hp * ( 1 + 0.14 * k ),
				acc: Math.min( 0.7, TYPES[ type ].acc * ( easy ? 0.75 : 1 + 0.12 * k ) ),
				dmg: TYPES[ type ].dmg * ( easy ? 0.85 : 1 + 0.1 * k ),
				reaction: easy ? 1.35 : Math.max( 0.45, 1 - 0.08 * k ),
				aimSpeed: easy ? 0.7 : 1 + 0.1 * k,
				speedMul: 1 + 0.025 * k
			} )
		};

	}

	beginWave( n, first = false ) {

		this.wave = n;
		this.cfg = this.waveConfig( n );
		this.spawned = 0;
		this.spawnT = first ? 3.5 : 2.0;
		this.state = 'combat';
		this.enemies.alerted = false;
		this.hud.setWave( n, this.stationName );
		this.hud.showBanner( this.stationName.toUpperCase(), `ВОЛНА ${ n }${ n === 1 ? ' · ОНИ УЖЕ ЗДЕСЬ' : '' }`, 4 );
		ctx.audio?.play( 'stinger', { vol: 0.5, reverb: 0.6 } );
		this.hud.objective( 'Зачистите станцию' );
		setTimeout( () => { if ( this.state === 'combat' ) this.hud.objective( null ); }, 5000 );

	}

	spawnEnemy() {

		const cfg = this.cfg;
		const type = cfg.types[ this.spawned ];
		const W = ctx.world;
		const p = this.player.position;
		// prefer distant spawns out of the player's sight
		const cands = W.spawns.slice().sort( () => Math.random() - 0.5 );
		const sp = cands.find( ( s ) => Math.hypot( s.x - p.x, s.z - p.z ) > 22 && ! W.visible( new THREE.Vector3( s.x, 1.6, s.z ), this.camera.position ) ) || cands.find( ( s ) => Math.hypot( s.x - p.x, s.z - p.z ) > 15 ) || cands[ 0 ];
		const jitter = { x: sp.x + ( Math.random() - 0.5 ) * 1.2, z: sp.z + ( Math.random() - 0.5 ) * 0.8 };
		this.enemies.spawn( type, cfg.stats( type ), jitter );
		this.spawned ++;

	}

	updateWave( dt ) {

		if ( this.state !== 'combat' && this.state !== 'arrived' ) return;
		if ( ! this.cfg ) return;
		const cfg = this.cfg;
		this.spawnT -= dt;
		if ( this.spawned < cfg.total && this.spawnT <= 0 && this.enemies.aliveCount < cfg.maxAlive ) {

			this.spawnEnemy();
			this.spawnT = cfg.gap * ( 0.7 + Math.random() * 0.6 );

		}

		const left = cfg.total - this.spawned + this.enemies.aliveCount;
		this.hud.setEnemies( left );
		if ( this.state === 'combat' && this.spawned >= cfg.total && this.enemies.aliveCount === 0 ) this.waveCleared();

	}

	waveCleared() {

		this.state = 'cleared';
		const bonus = 500 * this.wave;
		this.addScore( bonus );
		this.player.heal( 25 );
		this.weapons.refill( 0.6 );
		this.hud.showBanner( 'СТАНЦИЯ ЗАЧИЩЕНА', `+${ bonus } · поезд прибывает`, 4 );
		ctx.audio?.play( 'stinger', { vol: 0.4, reverb: 0.6, rate: 1.26 } );
		setTimeout( () => {

			if ( this.state !== 'cleared' ) return;
			this.train.prepareArrival( 280 );
			this.train.hornPlayed = false;
			this.state = 'trainArriving';
			this.hud.objective( 'Поезд прибывает — приготовьтесь к посадке' );

		}, 3500 );

	}

	onEnemyKilled() { /* score handled by Enemies */ }

	onLampDestroyed() {

		this.lampsBroken ++;
		this.addScore( 25 );
		if ( Math.random() < 0.2 ) {

			const alive = this.enemies.list.filter( ( e ) => e.alive );
			if ( alive.length ) alive[ Math.floor( Math.random() * alive.length ) ].speak( 'lamp', false, 1 );

		}

	}

	addScore( n ) { this.score += n; this.hud.setScore( this.score ); }

	announce( text, delay = 0 ) {

		setTimeout( () => this.voice.say( 'Информатор', text, { male: true, pitch: 0.9, rate: 0.95, priority: true, announce: true } ), delay );

	}

	// ------------------------------------------------------------------ train & travel

	onTrainEvent( e ) {

		const T = this.train;
		if ( e === 'stopped' ) {

			T.openDoors();
			ctx.audio?.play( 'chime', { pos: T.frontPos(), vol: 0.6, reverb: 0.4 } );
			if ( this.state === 'trainArriving' ) {

				this.announce( `Станция «${ this.stationName }».`, 900 );
				this.state = 'boarding';
				this.boardT = 0;
				this.hud.objective( 'Садитесь в поезд' );

			} else if ( this.state === 'travel' ) {

				// arrived at the next station: the ambush begins as the doors open
				this.state = 'arrived';
				this.stationsVisited ++;
				this.announce( `Станция «${ this.stationName }».`, 600 );
				this.exitT = 0;
				setTimeout( () => this.beginWave( this.wave + 1 ), 1800 );

			}

		} else if ( e === 'closed' ) {

			if ( this.state === 'departing' ) {

				if ( T.carAt( this.player.position.x, this.player.position.z ) === null ) {

					// the passenger stayed on the platform: the doors open again
					T.openDoors();
					this.state = 'boarding';
					this.boardT = 0;
					this.hud.objective( 'Садитесь в поезд' );
					return;

				}

				T.depart();
				this.state = 'travel';
				this.hud.objective( null );

			}

		} else if ( e === 'inTunnel' ) {

			if ( this.state === 'travel' && ! this.swapped && T.carAt( this.player.position.x, this.player.position.z ) !== null ) {

				this.swapped = true;
				T.flicker = 0.9;
				// swap the station while the carriage lights flicker in the dark tunnel
				setTimeout( () => this.swapStation(), 150 );

			}

		}

	}

	swapStation() {

		const T = this.train;
		const shift = - 2 * T.x;
		this.enemies.clear();
		this.stationIndex ++;
		this.loadStation( this.stationIndex );
		T.shift( shift );
		this.player.position.x += shift;
		this.camera.position.x += shift;
		T.state = 'arriving';
		T.v = Math.max( T.v, 15 );
		T.hornPlayed = true;
		this.swapped = false;
		this.gr.scenePass?.compileAsync?.( this.gr.renderer )?.catch?.( () => {} );

	}

	updateTrainFlow( dt ) {

		const T = this.train;
		const p = this.player.position;
		const inside = T.carAt( p.x, p.z ) !== null;
		// platform edge barrier: open only when the train is docked with doors open (or the player rides it)
		if ( this.edgeBox ) this.edgeBox.enabled = ! ( ( T.visible && Math.abs( T.x ) < 1 && T.doorOpen > 0.5 ) || inside );
		if ( this.state === 'boarding' ) {

			if ( inside ) {

				this.boardT += dt;
				if ( this.boardT > 1.5 ) {

					this.state = 'departing';
					const next = STATIONS[ ( this.stationIndex + 1 ) % STATIONS.length ].name;
					this.hud.objective( null );
					ctx.audio?.play( 'chime', { vol: 0.5, reverb: 0.2 } );
					this.announce( `Осторожно, двери закрываются. Следующая станция — «${ next }».`, 700 );
					setTimeout( () => T.closeDoors(), 4200 );

				}

			} else this.boardT = 0;

		}

		// after arriving: once the player has stepped out, the empty train leaves
		if ( ( this.state === 'arrived' || this.state === 'combat' ) && T.visible && T.state === 'open' ) {

			if ( ! inside ) {

				this.exitT = ( this.exitT || 0 ) + dt;
				if ( this.exitT > 5 ) { T.closeDoors(); this.leaving = true; }

			} else this.exitT = 0;

		}

		if ( this.leaving && T.state === 'closing' && T.doorOpen === 0 ) { T.depart(); this.leaving = false; }
		if ( T.state === 'departing' && this.state !== 'travel' && T.x > 330 ) T.hide();

	}

	// ------------------------------------------------------------------ death & restart

	onPlayerDeath() {

		this.state = 'dead';
		this.deadT = 0;
		const killer = this.enemies.list.find( ( e ) => e.alive );
		this.voice.say( killer?.name || 'Анжела', 'Спокойной ночи, милый.', { pitch: killer?.voicePitch || 1.3, priority: true } );
		this.hud.flash( 0.3 );

	}

	showGameOver() {

		this.input.unlock();
		const w = this.weapons.stats;
		const acc = w.shots ? Math.round( w.hits / w.shots * 100 ) : 0;
		const mins = Math.floor( ( performance.now() - this.time0 ) / 60000 );
		$( 'stats' ).innerHTML = `
			Волна: <b>${ this.wave }</b> · станций пройдено: <b>${ this.stationsVisited }</b><br>
			Убито противниц: <b>${ this.enemies.kills }</b> · в голову: <b>${ this.enemies.headshots }</b><br>
			Точность: <b>${ acc }%</b> · разбито светильников: <b>${ this.lampsBroken }</b><br>
			Время: <b>${ mins } мин</b> · Очки: <b>${ this.score.toLocaleString( 'ru-RU' ) }</b>`;
		$( 'gameover' ).classList.remove( 'hidden' );
		this.hud.show( false );

	}

	restart() {

		$( 'gameover' ).classList.add( 'hidden' );
		this.enemies.clear();
		this.enemies.kills = 0; this.enemies.headshots = 0;
		this.train.hide();
		this.stationIndex = 0;
		this.loadStation( 0 );
		this.player.health = 100; this.player.alive = true;
		this.player.spawn( - 6, 0, - Math.PI / 2 );
		this.weapons.resetAll();
		this.score = 0; this.hud.setScore( 0 );
		this.stationsVisited = 0; this.lampsBroken = 0;
		this.time0 = performance.now();
		this.gr.tint.value.setRGB( 1, 1, 1 );
		this.hud.show( true );
		this.input.lock();
		this.paused = false;
		this.beginWave( 1, true );

	}

	// ------------------------------------------------------------------ main loop

	frame() {

		// ?sim=N : headless logic test mode (N fixed steps per frame, rare rendering)
		if ( params.has( 'sim' ) ) {

			const n = + params.get( 'sim' ) || 20;
			for ( let i = 0; i < n; i ++ ) { this.step( 1 / 30 ); this.input.endFrame(); }
			this.frames = ( this.frames || 0 ) + 1;
			window.__ctxTime = ctx.time;
			if ( this.frames % ( + params.get( 'renderEvery' ) || 1000000 ) === 0 ) this.gr.render();
			return;

		}

		const now = performance.now();
		const dt = Math.min( 0.05, ( now - this.last ) / 1000 );
		this.last = now;
		this.step( dt );
		this.hud.update( dt, this.player, this.weapons, this.fpsShow );
		this.input.endFrame();
		this.gr.render();
		this.frames = ( this.frames || 0 ) + 1;
		if ( params.has( 'frames' ) && this.frames === + params.get( 'frames' ) ) { window.__done = true; this.gr.renderer.setAnimationLoop( null ); }

	}

	step( dt ) {

		if ( ! params.has( 'nodrs' ) && ! params.has( 'sim' ) ) this.gr.adapt( dt );
		this.fpsAcc += dt; this.fpsN ++;
		if ( this.fpsAcc > 0.5 ) { this.fpsShow = `${ Math.round( this.fpsN / this.fpsAcc ) } FPS · ${ this.gr.isWebGPU ? 'WebGPU' : 'WebGL2' } · ${ this.gr.preset.label } · ${ Math.round( this.gr.dprScale * 100 ) }%`; this.fpsAcc = 0; this.fpsN = 0; }
		const input = this.input;
		if ( this.bot ) this.bot.drive( dt, input );
		const running = this.started && ! this.paused;
		if ( this.state === 'dead' ) {

			this.deadT += dt;
			ctx.timeScale = Math.max( 0.25, 1 - this.deadT );
			this.gr.tint.value.setRGB( 1, Math.max( 0.35, 1 - this.deadT * 0.4 ), Math.max( 0.35, 1 - this.deadT * 0.4 ) );
			if ( this.deadT > 3 && ! this.overShown ) { this.overShown = true; this.showGameOver(); }

		} else {

			ctx.timeScale = 1;
			this.overShown = false;
			const hp = this.player.health;
			const low = hp < 35 ? ( 35 - hp ) / 35 : 0;
			this.gr.tint.value.setRGB( 1, 1 - low * 0.35, 1 - low * 0.35 );
			this.audio.setMuffle?.( low * 0.6 );
			this.heartT = ( this.heartT || 0 ) - dt;
			if ( low > 0.2 && this.heartT <= 0 && running ) { this.heartT = 1.1 - low * 0.4; ctx.audio?.play( 'heartbeat', { vol: 0.5 + low * 0.5, reverb: 0 } ); }

		}

		const sdt = dt * ctx.timeScale;
		if ( running || this.state === 'dead' ) {

			ctx.time += sdt;
			if ( input.hit( 'KeyF' ) ) { this.flashOn = ! this.flashOn; this.flashlight.intensity = this.flashOn ? 260 : 0; ctx.audio?.play( 'switch', { vol: 0.3, reverb: 0 } ); }
			this.player.update( sdt, input );
			if ( this.state === 'dead' ) {

				this.camera.rotation.z += sdt * 0.5 * Math.max( 0, 1 - this.deadT * 0.5 );
				this.player.eyeCur = Math.max( 0.35, this.player.eyeCur - sdt * 1.4 );

			}

			if ( this.player.alive ) this.weapons.update( sdt, input, this.player );
			this.enemies.update( sdt );
			this.updateWave( sdt );
			this.updateTrainFlow( sdt );
			this.train.update( sdt, this.player.position );
			ctx.world.update( sdt, ctx.time );
			this.fx.update( sdt );
			this.audio.listen( this.camera );

		} else {

			this.train.update( 0, this.player.position );

		}

	}

}

const game = new Game();
window.__game = game;
game.init().then( async () => {

	if ( params.has( 'bot' ) ) {

		const { Bot } = await import( './dev/bot.js' );
		game.bot = new Bot( game );

	}

} ).catch( ( e ) => {

	console.error( e );
	const el = $( 'error' );
	el.textContent = 'Ошибка запуска:\n' + ( e.stack || e.message || e ) + '\n\nОткройте игру через локальный веб-сервер (см. README) в Chrome/Edge последней версии.';
	el.classList.remove( 'hidden' );

} );
