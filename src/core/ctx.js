// Shared game context (set up in main.js). Keeps modules decoupled without globals on window.
export const ctx = {
	scene: null,
	camera: null,
	renderer: null,
	world: null,      // current StationWorld
	infra: null,
	fx: null,
	audio: null,
	voice: null,
	player: null,
	weapons: null,
	enemies: null,
	train: null,
	hud: null,
	game: null,
	time: 0,
	timeScale: 1
};
