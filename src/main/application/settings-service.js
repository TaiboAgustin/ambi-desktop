// Ajustes editables desde la UI. Recibe parches ya validados (domain/validation.settingsPatch).
class SettingsService {
  /**
   * @param {object} deps
   * @param {object} deps.config  configuración viva
   * @param {import('./device-manager').DeviceManager} deps.devices
   */
  constructor({ config, save, devices, onWindowPrefs }) {
    Object.assign(this, { config, save, devices, onWindowPrefs });
  }

  publicView() {
    const c = this.config;
    const tv = this.devices.entry('tv');
    return {
      ip: tv?.settings.address || '', mac: tv?.settings.mac || '', paired: !!tv?.secrets.token,
      alwaysOnTop: c.ui.alwaysOnTop,
      ps5Hdmi: c.inputs.ps5Hdmi, switchHdmi: c.inputs.switchHdmi,
      mirrorQuality: c.mirror.quality,
      mirror: { sourceId: c.mirror.sourceId, audio: c.mirror.audio },
      ambient: { sourceId: c.ambient.sourceId, maxDim: c.ambient.maxDim },
      devices: this.devices.summary(),
    };
  }

  update(patch) {
    const c = this.config;
    const tv = this.devices.entry('tv');
    const tvPatch = {};
    if ('ip' in patch && patch.ip !== (tv?.settings.address || '')) tvPatch.address = patch.ip;
    if ('mac' in patch && patch.mac !== (tv?.settings.mac || '')) tvPatch.mac = patch.mac;
    // Otra IP es otro equipo: sus credenciales de emparejamiento dejan de valer.
    if (Object.keys(tvPatch).length) this.devices.upsert('tv', tvPatch, { resetSecrets: 'address' in tvPatch });
    if ('alwaysOnTop' in patch) c.ui.alwaysOnTop = patch.alwaysOnTop;
    if ('ps5Hdmi' in patch) c.inputs.ps5Hdmi = patch.ps5Hdmi;
    if ('switchHdmi' in patch) c.inputs.switchHdmi = patch.switchHdmi;
    if ('mirrorQuality' in patch) c.mirror.quality = patch.mirrorQuality;
    this.save();
    this.onWindowPrefs({ alwaysOnTop: c.ui.alwaysOnTop });
    return this.publicView();
  }
}

module.exports = { SettingsService };
