// Ajustes editables desde la UI. Recibe parches ya validados (domain/validation.settingsPatch).
class SettingsService {
  constructor({ config, save, tv, onWindowPrefs }) {
    Object.assign(this, { config, save, tv, onWindowPrefs });
  }

  publicView() {
    const c = this.config;
    return {
      ip: c.tv.ip, mac: c.tv.mac, paired: !!c.tv.token,
      alwaysOnTop: c.ui.alwaysOnTop,
      ps5Hdmi: c.inputs.ps5Hdmi, switchHdmi: c.inputs.switchHdmi,
      mirrorQuality: c.mirror.quality,
      mirror: { sourceId: c.mirror.sourceId, audio: c.mirror.audio },
      ambient: { sourceId: c.ambient.sourceId, maxDim: c.ambient.maxDim },
    };
  }

  update(patch) {
    const c = this.config;
    const ipChanged = 'ip' in patch && patch.ip !== c.tv.ip;
    if ('ip' in patch) c.tv.ip = patch.ip;
    if ('mac' in patch) c.tv.mac = patch.mac;
    if ('alwaysOnTop' in patch) c.ui.alwaysOnTop = patch.alwaysOnTop;
    if ('ps5Hdmi' in patch) c.inputs.ps5Hdmi = patch.ps5Hdmi;
    if ('switchHdmi' in patch) c.inputs.switchHdmi = patch.switchHdmi;
    if ('mirrorQuality' in patch) c.mirror.quality = patch.mirrorQuality;
    this.save();
    this.tv.onSettingsChanged({ ipChanged });
    this.onWindowPrefs({ alwaysOnTop: c.ui.alwaysOnTop });
    return this.publicView();
  }
}

module.exports = { SettingsService };
