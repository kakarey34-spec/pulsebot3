/** Default guild configuration — merged with persisted JSON on load. */
module.exports = {
  prefix: '!',
  tickets: {
    categoryId: null,
    supportRoleIds: [],
    viewerRoleIds: [],
    viewerUserIds: [],
    logChannelId: '1517513514397204520',
    panelChannelId: null,
    panelMessageId: null,
    welcomeMessage:
      'Welcome {user}! Select a payment method below to complete your purchase.',
    awaitingProofMessage:
      'Upload your payment proof — screenshot, receipt, or transaction ID in one message.',
    waitingApprovalMessage:
      'Your proof is in review. Staff will verify and approve shortly.',
    approvedMessage:
      '**Order approved.** Your payment was verified. Thank you for shopping with Pulse Studio.',
    deniedMessage:
      'We could not verify this payment. Reply here with more details or contact staff.',
    closedMessage: 'This ticket has been closed. Open a new one from the panel if you need more help.',
    openCooldownMinutes: 5,
    inactiveCloseHours: 48,
    categoryLogChannels: {
      payments: '1517513514397204520',
      support: '1517513514397204520',
      partner: '1517513514397204520',
    },
    categoryWelcomeMessages: {
      payments:
        'Welcome {user}! Enter your **Product ID** when prompted, then choose a payment method.',
      support:
        'Welcome {user}! Describe your issue and staff will assist you shortly.',
      partner:
        'Welcome {user}! Tell us about your partnership inquiry and our team will respond.',
    },
  },
  payments: {
    paypal: {
      label: 'PayPal',
      enabled: true,
      email: 'payments@pulsestudio.example',
      details: 'Send payment via PayPal Friends & Family. Include your Discord username in the note.',
    },
    paysafe: {
      label: 'PaySafe',
      enabled: true,
      details: 'Purchase a PaySafe card matching the rounded amount shown below and send the code here.',
    },
  },
  roles: {
    ownerRoleId: '1517510292526075925',
    modRoleId: '1517887427300036628',
    sellerRoleId: '1517887595638558830',
    purchaserRoleId: null,
    autoRoleId: null,
    staffRoleIds: [],
    muteRoleId: null,
  },
  whitelist: {
    userIds: [],
    adminRoleIds: [],
    staffRoleIds: [],
    configRoleIds: [],
  },
  blacklist: {
    ticketUserIds: [],
  },
  moderation: {
    muteDurationMinutes: 10,
  },
  channels: {
    repChannelId: '1517500145149935636',
    suggestionChannelId: '1517695780490707014',
    promocodeChannelId: null,
    memberLogs: '1517512986409959425',
    channelLogs: '1517513252341289151',
    roleLogs: '1517513287363854447',
    voiceLogs: '1517513324919521290',
    moderationLogs: '1517513378837303406',
    ticketLogs: '1517513514397204520',
    antilinkLogs: '1517513591006167242',
    commandLogs: '1517513697889747044',
    securityLogs: '1517513767129190523',
    serverLogs: '1517513808900395058',
  },
  security: {
    antiNukeEnabled: true,
    antiLinkEnabled: true,
    nukeThreshold: 3,
    nukeWindowMs: 60000,
    whitelistedUserIds: [],
  },
  promos: {},
  onJoin: {
    welcomeDmEnabled: false,
    welcomeDm: 'Welcome to **Pulse Studio**, {user}! Browse the server and open a ticket when ready.',
  },
  embeds: {
    color: 0xbb44ff,
    accent: 0x00e5ff,
    footer: 'Pulse Studio · Made By LyxosDime',
  },
};
