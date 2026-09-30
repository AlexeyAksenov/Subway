// Speech synthesis for enemy taunts and metro announcements (Web Speech API, ru-RU voices).
import { ctx } from './ctx.js';

export class Voice {

	constructor() {

		this.enabled = true;
		this.voices = [];
		this.busyUntil = 0;
		this.supported = typeof speechSynthesis !== 'undefined';
		if ( this.supported ) {

			const load = () => { this.voices = speechSynthesis.getVoices(); };
			load();
			speechSynthesis.onvoiceschanged = load;

		}

	}

	pick( female = true, lang = 'ru' ) {

		const ru = this.voices.filter( ( v ) => v.lang && v.lang.toLowerCase().startsWith( lang ) );
		const femaleNames = /irina|milena|svetlana|alyona|alena|katya|ekaterina|anna|daria|dariya|elena|tatyana|google русский|natalia|polina|female|жен/i;
		const maleNames = /pavel|dmitri|dmitry|maxim|yuri|male|муж/i;
		if ( female ) return ru.find( ( v ) => femaleNames.test( v.name ) ) || ru.find( ( v ) => ! maleNames.test( v.name ) ) || ru[ 0 ] || null;
		return ru.find( ( v ) => maleNames.test( v.name ) ) || ru[ 0 ] || null;

	}

	/**
	 * Speak a line. Always shows a subtitle; speech is skipped if another line is playing
	 * (unless priority), so the soundscape never turns into a queue of chatter.
	 */
	say( speaker, text, { pitch = 1.2, rate = 1.05, priority = false, announce = false, male = false, volume = 1 } = {} ) {

		const now = performance.now();
		if ( ! priority && now < this.busyUntil ) return false;
		ctx.hud?.subtitle( speaker, text, { announce, dur: Math.max( 2.2, text.length * 0.065 ) } );
		const est = 600 + text.length * 70 / rate;
		this.busyUntil = now + est;
		if ( ! this.enabled || ! this.supported ) return true;
		try {

			if ( priority ) speechSynthesis.cancel();
			const u = new SpeechSynthesisUtterance( text );
			u.lang = 'ru-RU';
			const v = this.pick( ! male );
			if ( v ) u.voice = v;
			u.pitch = pitch;
			u.rate = rate;
			u.volume = Math.min( 1, volume * ( ctx.audio?.volume ?? 1 ) * 1.1 );
			u.onend = () => { this.busyUntil = performance.now() + 250; };
			speechSynthesis.speak( u );

		} catch ( e ) { /* speech is optional */ }

		return true;

	}

	stop() { try { if ( this.supported ) speechSynthesis.cancel(); } catch ( e ) { /* */ } this.busyUntil = 0; }

}
