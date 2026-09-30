// Station registry.
import { buildKomsomolskaya } from './komsomolskaya.js';
import { buildMayakovskaya } from './mayakovskaya.js';
import { buildNovoslobodskaya } from './novoslobodskaya.js';

const BUILDERS = {
	komsomolskaya: buildKomsomolskaya,
	mayakovskaya: buildMayakovskaya,
	novoslobodskaya: buildNovoslobodskaya
};

export function buildStation( W, id, opts = {} ) {

	return ( BUILDERS[ id ] || buildKomsomolskaya )( W, opts );

}
