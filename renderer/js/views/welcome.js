// welcome.js — first screen when you have no servers yet

Views.welcome = {
  title: '',
  render(root) {
    // [picture name, title, text] for each feature box
    const features = [
      ['globe', 'No port forwarding', 'A free playit.gg tunnel gives you an address like <span class="mono">boba-tea.joinmc.link</span> that never changes.'],
      ['package', 'Any server type', 'Vanilla, Paper, Purpur, Fabric, Forge, NeoForge, Quilt, or a full Modrinth modpack.'],
      ['coffee', 'Java handled for you', 'The right Java version downloads by itself. Nothing to install.'],
      ['laptop', 'Built-in console', 'Live colored logs, command history and suggestions.'],
      ['openfolder', 'File explorer', 'Browse, edit, upload, zip and unzip server files right here.'],
      ['floppy', 'Auto backups', 'Scheduled world backups and one-click restore.']
    ];
    root.innerHTML = `
      <div class="welcome">
        <img class="welcome-logo" src="../assets/logo.png" alt="" />
        <h1>Welcome to <span class="gradient-text">Boba</span></h1>
        <p class="lead">Host your own Minecraft server in a few clicks. No port forwarding, a permanent address for your friends, and every setting explained.</p>
        <div class="row" style="justify-content:center">
          <button class="btn primary lg" data-create>${icon('plus')}Create your first server</button>
          <button class="btn lg" data-import data-tip="Already have a server folder, zip or .mrpack? Bring it in.">${icon('import')}Import existing</button>
        </div>
        <div class="feature-grid">
          ${features.map(([pic, title, text]) => `<div class="feature">${emoji(pic, 44)}<b>${title}</b><span>${text}</span></div>`).join('')}
        </div>
      </div>`;
    $('[data-create]', root).onclick = () => App.go('create');
    $('[data-import]', root).onclick = () => App.go('create', { type: 'import' });
  }
};
