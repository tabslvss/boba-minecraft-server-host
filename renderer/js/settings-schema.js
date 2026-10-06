// settings-schema.js
// Every server.properties setting shown in the Settings page,
// with a short tooltip ("tip") and an example ("ex").

const PROPERTY_SECTIONS = [
  {
    id: 'general', title: 'General', icon: 'home',
    items: [
      { key: 'motd', label: 'Server message (MOTD)', type: 'text', default: 'A Minecraft Server',
        tip: 'Text under your server name in the multiplayer list. Use § codes for colors.',
        ex: '§bBoba §fSMP §7- §aSurvival', wide: true },
      { key: 'max-players', label: 'Max players', type: 'number', min: 1, max: 1000, default: 20,
        tip: 'Most players that can be online at the same time.', ex: '20' },
      { key: 'gamemode', label: 'Game mode', type: 'select', default: 'survival',
        options: [['survival', 'Survival'], ['creative', 'Creative'], ['adventure', 'Adventure'], ['spectator', 'Spectator']],
        tip: 'The mode new players start in.', ex: 'creative = build mode, unlimited blocks' },
      { key: 'force-gamemode', label: 'Force game mode', type: 'toggle', default: false,
        tip: 'Puts players back to the game mode above every time they join.', ex: 'On = someone in creative goes back to survival on rejoin' },
      { key: 'difficulty', label: 'Difficulty', type: 'select', default: 'easy',
        options: [['peaceful', 'Peaceful'], ['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']],
        tip: 'How strong mobs are. Peaceful = no hostile mobs.', ex: 'hard = zombies can break doors' },
      { key: 'hardcore', label: 'Hardcore', type: 'toggle', default: false,
        tip: 'One life only. When you die you become a spectator.', ex: 'Great for challenge servers' },
      { key: 'pvp', label: 'PvP', type: 'toggle', default: true,
        tip: 'Lets players hurt each other.', ex: 'Off = friendly server, no fighting' },
      { key: 'allow-flight', label: 'Allow flight', type: 'toggle', default: false,
        tip: 'Stops the server kicking players for "flying". Turn on if you use fly / jetpack mods.', ex: 'On for modpacks with jetpacks' },
      { key: 'spawn-protection', label: 'Spawn protection', type: 'number', min: 0, max: 1000, default: 16, unit: 'blocks',
        tip: 'Blocks around spawn that only operators can break. 0 = off.', ex: '16 = a 33×33 safe area' },
      { key: 'player-idle-timeout', label: 'AFK kick', type: 'number', min: 0, max: 1440, default: 0, unit: 'min',
        tip: 'Kick players who do nothing for this many minutes. 0 = never.', ex: '30' }
    ]
  },
  {
    id: 'world', title: 'World', icon: 'world',
    items: [
      { key: 'level-name', label: 'World folder', type: 'text', default: 'world',
        tip: 'Name of the world folder. A new name makes a brand new world. Old one is kept.', ex: 'world2' },
      { key: 'level-seed', label: 'Seed', type: 'text', default: '', placeholder: 'Random',
        tip: 'Decides how a NEW world looks. Blank = random. Only works when the world is created.', ex: '-4172144997902289642' },
      { key: 'level-type', label: 'World type', type: 'select', default: 'minecraft:normal',
        options: [['minecraft:normal', 'Normal'], ['minecraft:flat', 'Superflat'], ['minecraft:large_biomes', 'Large biomes'], ['minecraft:amplified', 'Amplified (tall mountains)']],
        tip: 'Shape of NEW worlds.', ex: 'Superflat = flat land, good for building' },
      { key: 'generate-structures', label: 'Structures', type: 'toggle', default: true,
        tip: 'Makes villages, temples, strongholds etc. in new chunks.', ex: 'Off = empty land only' },
      { key: 'allow-nether', label: 'Allow Nether', type: 'toggle', default: true,
        tip: 'Lets players go to the Nether through portals.', ex: 'Off = portals do nothing' },
      { key: 'spawn-monsters', label: 'Monsters', type: 'toggle', default: true,
        tip: 'Hostile mobs like zombies and creepers spawn.', ex: 'Off = safe nights' },
      { key: 'spawn-animals', label: 'Animals', type: 'toggle', default: true,
        tip: 'Cows, pigs, sheep etc. spawn. (Older versions only.)', ex: 'On' },
      { key: 'spawn-npcs', label: 'Villagers', type: 'toggle', default: true,
        tip: 'Villagers spawn in villages.', ex: 'On' },
      { key: 'max-world-size', label: 'World border radius', type: 'number', min: 1, max: 29999984, default: 29999984, unit: 'blocks',
        tip: 'How far the world goes from the center. Smaller = smaller world file.', ex: '5000 = 10,000×10,000 world' }
    ]
  },
  {
    id: 'performance', title: 'Performance', icon: 'zap',
    items: [
      { key: 'view-distance', label: 'View distance', type: 'range', min: 2, max: 32, default: 10, format: (v) => `${v} chunks`,
        tip: 'How far players can see. Lower = less lag and less RAM.', ex: '6-8 for a weak PC, 10 is normal' },
      { key: 'simulation-distance', label: 'Simulation distance', type: 'range', min: 2, max: 32, default: 10, format: (v) => `${v} chunks`,
        tip: 'How far away mobs move and crops grow. Lower = less lag.', ex: '6 is a good saver' },
      { key: 'entity-broadcast-range-percentage', label: 'Entity show range', type: 'range', min: 10, max: 500, step: 10, default: 100, format: (v) => `${v}%`,
        tip: 'How far away mobs/players are visible. Lower helps weak internet.', ex: '75%' },
      { key: 'network-compression-threshold', label: 'Network compression', type: 'number', min: -1, max: 65535, default: 256, unit: 'bytes',
        tip: 'Packets bigger than this get compressed. -1 = off. Leave it unless you know why.', ex: '256' },
      { key: 'sync-chunk-writes', label: 'Safe chunk saving', type: 'toggle', default: true,
        tip: 'Saves chunks more safely. Off = a bit faster but risk on crashes.', ex: 'Keep On' },
      { key: 'max-tick-time', label: 'Watchdog time', type: 'number', min: -1, default: 60000, unit: 'ms',
        tip: 'Server shuts down if one tick takes longer than this. -1 = never. Big modpacks may need -1.', ex: '-1 for heavy modpacks' }
    ]
  },
  {
    id: 'security', title: 'Players & Security', icon: 'shield',
    items: [
      { key: 'online-mode', label: 'Online mode', type: 'toggle', default: true,
        tip: 'Checks every player owns Minecraft. Off lets anyone join with any name (unsafe!).', ex: 'Keep On' },
      { key: 'white-list', label: 'Whitelist', type: 'toggle', default: false,
        tip: 'Only players on the whitelist can join. Add them in the Players tab.', ex: 'On for private friend servers' },
      { key: 'enforce-whitelist', label: 'Kick non-whitelisted', type: 'toggle', default: false,
        tip: 'When the whitelist reloads, kick anyone not on it.', ex: 'On' },
      { key: 'enforce-secure-profile', label: 'Secure chat', type: 'toggle', default: true,
        tip: 'Requires signed chat messages. Turn Off if players see chat errors.', ex: 'Off for many modpacks' },
      { key: 'enable-command-block', label: 'Command blocks', type: 'toggle', default: false,
        tip: 'Lets command blocks work.', ex: 'On for minigame maps' },
      { key: 'op-permission-level', label: 'Operator power', type: 'select', default: '4',
        options: [['1', '1 - Bypass spawn protection'], ['2', '2 - + Cheat commands'], ['3', '3 - + Kick / ban'], ['4', '4 - Everything']],
        tip: 'What operators (admins) are allowed to do.', ex: '4 = full control' },
      { key: 'hide-online-players', label: 'Hide player list', type: 'toggle', default: false,
        tip: 'Hides who is online from the multiplayer menu.', ex: 'On for privacy' }
    ]
  },
  {
    id: 'network', title: 'Network', icon: 'wifi',
    items: [
      { key: 'server-port', label: 'Port', type: 'number', min: 1, max: 65535, default: 25565,
        tip: 'Where the server listens. Your playit tunnel must point to the same port. Two servers can\'t share one.', ex: '25565 (default)' },
      { key: 'server-ip', label: 'Bind IP', type: 'text', default: '', placeholder: 'Leave blank',
        tip: 'Leave this blank! Only for PCs with many network cards.', ex: '(blank)' },
      { key: 'enable-status', label: 'Show in server list', type: 'toggle', default: true,
        tip: 'Off makes the server look offline in the list (players can still join).', ex: 'On' },
      { key: 'enable-query', label: 'Query', type: 'toggle', default: false,
        tip: 'Lets websites/tools read player counts. Not needed for most.', ex: 'Off' },
      { key: 'enable-rcon', label: 'Remote console (RCON)', type: 'toggle', default: false,
        tip: 'Control the server from other tools. Needs a password below.', ex: 'Off unless you use a bot' },
      { key: 'rcon.port', label: 'RCON port', type: 'number', min: 1, max: 65535, default: 25575,
        tip: 'Port for RCON.', ex: '25575' },
      { key: 'rcon.password', label: 'RCON password', type: 'password', default: '',
        tip: 'Password for RCON. Make it long.', ex: 'b0ba-t3a-is-gr8!' }
    ]
  },
  {
    id: 'resourcepack', title: 'Resource Pack', icon: 'image',
    items: [
      { key: 'resource-pack', label: 'Pack download link', type: 'text', default: '', placeholder: 'https://...zip', wide: true,
        tip: 'Direct download link to a resource pack .zip. Players get asked to use it.', ex: 'https://example.com/mypack.zip' },
      { key: 'require-resource-pack', label: 'Required', type: 'toggle', default: false,
        tip: 'Kick players who say No to the pack.', ex: 'On for custom maps' },
      { key: 'resource-pack-prompt', label: 'Prompt message', type: 'text', default: '',
        tip: 'Message shown when asking players to use the pack.', ex: 'Please use our pack for the best look!' }
    ]
  }
];
