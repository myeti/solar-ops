/**
 * The settings API saves every general setting at once: these helpers let
 * each settings section load the whole object and save it back with only
 * its own fields changed.
 */
import api from '../../services/api.js';

/**
 * @returns {Promise<{settings: object, meta: object}>}
 */
export function loadSettings() {
  return api.get('/settings');
}

/**
 * @param {object} settings complete settings object
 * @returns {Promise<{settings: object, meta: object}>}
 */
export function saveSettings(settings) {
  return api.put('/settings', {
    baseFolder: settings.baseFolder,
    authMethod: settings.authMethod,
    acmeEmail: settings.acmeEmail,
    acmeStaging: settings.acmeStaging,
    serverIp: settings.serverIp,
    serverIpv6: settings.serverIpv6,
    firstPort: settings.firstPort,
    portStep: settings.portStep,
  });
}
