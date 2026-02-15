const KNOWN_MAPS = {
    'de_mirage': 'Mirage',
    'de_inferno': 'Inferno',
    'de_dust2': 'Dust 2',
    'de_nuke': 'Nuke',
    'de_overpass': 'Overpass',
    'de_vertigo': 'Vertigo',
    'de_ancient': 'Ancient',
    'de_anubis': 'Anubis',
    'de_train': 'Train',
    'de_cache': 'Cache',
    'cs_office': 'Office',
    'cs_italy': 'Italy'
};

function normalizeMapName(rawName) {
    if (!rawName) return 'Unknown';
    if (KNOWN_MAPS[rawName]) return KNOWN_MAPS[rawName];
    if (typeof rawName === 'string' && rawName.startsWith('de_')) {
        return rawName.replace('de_', '').charAt(0).toUpperCase() + rawName.slice(4);
    }
    // Filter out numeric IDs which are likely match IDs or invalid map data
    if (/^\d+$/.test(rawName)) return 'Unknown';
    return rawName;
}

module.exports = { normalizeMapName };
