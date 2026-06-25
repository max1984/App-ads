const DOMAIN_REGEX = /^(?=.{1,253}$)(?!-)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/
const TAG_CERT_REGEX = /^[0-9a-f]{16}$/  // TAG cert IDs are exactly 16 lowercase hex chars

const SUPPORTED_VARIABLES = new Set([
  'CONTACT', 'SUBDOMAIN', 'INVENTORYPARTNERDOMAIN', 'OWNERDOMAIN', 'MANAGERDOMAIN'
])

export const TOP_NETWORKS = [
  { domain: 'google.com',         name: 'Google (Authorized Buyers)' },
  { domain: 'appnexus.com',       name: 'AppNexus / Xandr' },
  { domain: 'rubiconproject.com', name: 'Magnite / Rubicon Project' },
  { domain: 'pubmatic.com',       name: 'PubMatic' },
  { domain: 'openx.com',         name: 'OpenX' },
  { domain: 'indexexchange.com',  name: 'Index Exchange' },
  { domain: 'criteo.com',         name: 'Criteo' },
  { domain: 'triplelift.com',     name: 'TripleLift' },
  { domain: 'aps.amazon.com',     name: 'Amazon Publisher Services' },
  { domain: 'facebook.com',       name: 'Meta Audience Network' },
  { domain: 'inmobi.com',         name: 'InMobi' },
  { domain: 'applovin.com',       name: 'AppLovin' },
  { domain: 'ironsource.com',     name: 'IronSource' },
  { domain: 'vungle.com',         name: 'Vungle (Liftoff)' },
  { domain: 'adcolony.com',       name: 'AdColony' },
  { domain: 'chartboost.com',     name: 'Chartboost' },
  { domain: 'smaato.com',         name: 'Smaato' },
  { domain: 'mintegral.com',      name: 'Mintegral' },
  { domain: 'sovrn.com',          name: 'Sovrn / Lijit' },
  { domain: 'sharethrough.com',   name: 'Sharethrough' },
]

// TAG Certified Against Fraud IDs — cert ID → network name
export const VALID_CA_IDS = {
  // Google
  'f08c47fec0942fa0': 'Google (Authorized Buyers / DFP)',
  '7842df1d2fe2db34': 'Google AdSense / AdMob / SpotX',
  // Meta / Facebook
  'c3e20eee3f780d68': 'Meta (Facebook Audience Network)',
  // Amazon
  '18e5c4a0b8280590': 'Amazon Publisher Services',
  // Magnite (formerly Rubicon Project)
  '0bfd66d529a55807': 'Magnite (Rubicon Project)',
  // PubMatic
  '5d62403b186f2ace': 'PubMatic',
  // OpenX
  '6a698e2ec38604c6': 'OpenX',
  // AppNexus / Xandr
  'f5ab79cb980f11d1': 'AppNexus / Xandr',
  // Index Exchange
  '50b1c356f2c5c8fc': 'Index Exchange',
  // Criteo
  '9fac4a4a87c2a44f': 'Criteo',
  '3fd707be9c4527c3': 'Criteo',
  // Sharethrough
  'd53b998a7bd4ecd2': 'Sharethrough',
  // Sovrn / Lijit
  'fafdf38b16bf6b2b': 'Sovrn / Lijit',
  // TripleLift
  '6c33edb13117fd86': 'TripleLift',
  '6a92c77cfc3d2258': 'TripleLift',
  // Smaato
  '07bcf65f187117b4': 'Smaato',
  // LoopMe
  '6c8d5f95897a5a3b': 'LoopMe',
  // InMobi
  '83e75a7ae333ca9d': 'InMobi',
  '9e1ce09b7cb0e6e8': 'InMobi',
  // The Media Grid
  '35d5010d7789b49d': 'The Media Grid',
  // PulsePoint / ContextWeb
  '89ff185a4c4e857c': 'PulsePoint (ContextWeb)',
  // Conversant
  '03113cd04947736d': 'Conversant Media',
  // E-Planning
  'c1ba615865ed87b2': 'E-Planning',
  // PubNative
  'd641df8625486a7b': 'PubNative (Verve Group)',
  // Sonobi
  'd1a215d9eb5aee9e': 'Sonobi',
  // Smart AdServer (Equativ)
  '060d053dcf45cbf3': 'Smart AdServer (Equativ)',
  // Adform
  '9f5210a2f0999e32': 'Adform',
  // Yahoo / Verizon Media
  'e1a5b5b6e3255540': 'Yahoo (Verizon Media)',
  'e1a5b5b704a45b4e': 'Verizon Media / Oath',
  // Unruly Media
  '6f752381ad5ec0e5': 'Unruly Media',
  // AdColony (Digital Turbine)
  '1ad675c9de6b5176': 'AdColony (Digital Turbine)',
  // MobFox
  '5529a3d1f59865be': 'MobFox',
  // Chartboost
  'c09acac31a81d462': 'Chartboost',
  // AppLovin
  '7118c6312e0b7d84': 'AppLovin',
  // IronSource
  'a670e2c36b2c2a9d': 'IronSource',
  // Unity Ads
  'c228e6794e811952': 'Unity Ads',
  // Fyber / Digital Turbine
  '59c49ff303f41b7f': 'Fyber (Digital Turbine)',
  // MoPub (deprecated)
  'a2765ed5dbc692ec': 'MoPub (Twitter, deprecated)',
  // Vungle / Liftoff
  '4c559b06b9b9483b': 'Vungle (Liftoff)',
  // 33Across
  'bbea06d9c4d2853c': '33Across',
  // Undertone
  'd954590d0cb265b9': 'Undertone',
  // EMX Digital
  '1e1d41537f7cad7f': 'EMX Digital',
  // Beachfront
  'e2541279e8e2ca4d': 'Beachfront',
  // Consumable
  'aefcd3d2f45b5070': 'Consumable',
  // Opera
  '55a0c5fd61378de3': 'Opera',
  // Vidazoo
  'b6ada874b4d7d0b2': 'Vidazoo',
  // Video Heroes
  '064bc410192443d8': 'Video Heroes',
  // The Brave
  'c25b2154543746ac': 'The Brave',
  // MGID
  'd4c29acad76ce94f': 'MGID',
  // Luna Media
  '524ecb396915caaf': 'Luna Media',
  // Algorix
  '5b394c12fea27a1d': 'Algorix',
  // AdView
  '1b2cc038a11ea319': 'AdView',
  // Mintegral
  '0aeed750c80d6423': 'Mintegral',
  // Triton Digital
  '19b4454d0b87b58b': 'Triton Digital',
  // IMDS
  'ae6c32151e71f19d': 'IMDS',
  // ConnectAd
  '85ac85a30c93b3e5': 'ConnectAd',
  // PubWise
  'c327c91a93a7cdd3': 'PubWise',
  // Axonix
  'bc385f2b4a87b721': 'Axonix',
  // IION
  '013a29748465dc57': 'IION',
  // TopOnAd
  '1d49fe424a1a456d': 'TopOnAd',
  // TVP
  '1125b6434104a723': 'TVP',
  // ACEex
  'b1cf3c874d5c6682': 'ACEex',
  // POKKT
  'c45702d9311e25fd': 'POKKT',
  // Hindsight Solutions
  '20e30b2ae1f670f2': 'Hindsight Solutions',
  // BizzClick
  '7e936b1feafdaa61': 'BizzClick',
  // Blis
  '61453ae19a4b73f4': 'Blis',
  // Bold Win
  '71746737d0bab951': 'Bold Win',
  // Adyoulike
  '4ad745ead2958bf7': 'Adyoulike',
  // Keenkale
  '6c1c00b269ccdfa4': 'Keenkale',
  // xAd / GroundTruth
  '81cbf0a75a5e0e9a': 'xAd / GroundTruth',
}

// Domain → cert ID mapping (derived from known TAG certifications)
const DOMAIN_TO_CERT = {
  // Google
  'google.com':              'f08c47fec0942fa0',
  'googleadservices.com':    'f08c47fec0942fa0',
  // Meta
  'facebook.com':            'c3e20eee3f780d68',
  // Amazon
  'aps.amazon.com':          '18e5c4a0b8280590',
  // Magnite / Rubicon Project
  'rubiconproject.com':      '0bfd66d529a55807',
  'magnite.com':             '0bfd66d529a55807',
  // PubMatic
  'pubmatic.com':            '5d62403b186f2ace',
  // OpenX
  'openx.com':               '6a698e2ec38604c6',
  // AppNexus / Xandr
  'appnexus.com':            'f5ab79cb980f11d1',
  'xandr.com':               'f5ab79cb980f11d1',
  // Index Exchange
  'indexexchange.com':       '50b1c356f2c5c8fc',
  // Criteo
  'criteo.com':              '9fac4a4a87c2a44f',
  // Sharethrough
  'sharethrough.com':        'd53b998a7bd4ecd2',
  // Sovrn / Lijit
  'sovrn.com':               'fafdf38b16bf6b2b',
  'lijit.com':               'fafdf38b16bf6b2b',
  // TripleLift
  'triplelift.com':          '6c33edb13117fd86',
  // Smaato
  'smaato.com':              '07bcf65f187117b4',
  // LoopMe
  'loopme.com':              '6c8d5f95897a5a3b',
  // InMobi
  'inmobi.com':              '83e75a7ae333ca9d',
  // The Media Grid
  'themediagrid.com':        '35d5010d7789b49d',
  // PulsePoint / ContextWeb
  'contextweb.com':          '89ff185a4c4e857c',
  // Conversant
  'conversantmedia.com':     '03113cd04947736d',
  // E-Planning
  'e-planning.net':          'c1ba615865ed87b2',
  // PubNative
  'pubnative.net':           'd641df8625486a7b',
  // Sonobi
  'sonobi.com':              'd1a215d9eb5aee9e',
  // Smart AdServer
  'smartadserver.com':       '060d053dcf45cbf3',
  // Adform
  'adform.com':              '9f5210a2f0999e32',
  // Yahoo
  'yahoo.com':               'e1a5b5b6e3255540',
  // Unruly
  'video.unrulymedia.com':   '6f752381ad5ec0e5',
  'unrulymedia.com':         '6f752381ad5ec0e5',
  // SpotX
  'spotxchange.com':         '7842df1d2fe2db34',
  'spotx.tv':                '7842df1d2fe2db34',
  // MobFox
  'mobfox.com':              '5529a3d1f59865be',
  'uis.mobfox.com':          '5529a3d1f59865be',
  // AdColony
  'adcolony.com':            '1ad675c9de6b5176',
  // Chartboost
  'chartboost.com':          'c09acac31a81d462',
  // AppLovin
  'applovin.com':            '7118c6312e0b7d84',
  // IronSource
  'ironsource.com':          'a670e2c36b2c2a9d',
  // Vungle / Liftoff
  'vungle.com':              '4c559b06b9b9483b',
  // Fyber
  'fyber.com':               '59c49ff303f41b7f',
  // 33Across
  '33across.com':            'bbea06d9c4d2853c',
  // Yieldmo
  'yieldmo.com':             '6a92c77cfc3d2258',
  // Undertone
  'undertone.com':           'd954590d0cb265b9',
  // EMX Digital
  'emxdgt.com':              '1e1d41537f7cad7f',
  // Beachfront
  'beachfront.com':          'e2541279e8e2ca4d',
  // Consumable
  'consumable.com':          'aefcd3d2f45b5070',
  // Opera
  'opera.com':               '55a0c5fd61378de3',
  // Vidazoo
  'vidazoo.com':             'b6ada874b4d7d0b2',
  // Video Heroes
  'videoheroes.tv':          '064bc410192443d8',
  // The Brave
  'thebrave.io':             'c25b2154543746ac',
  // MGID
  'mgid.com':                'd4c29acad76ce94f',
  // Luna Media
  'lunamedia.io':            '524ecb396915caaf',
  // Algorix
  'algorix.co':              '5b394c12fea27a1d',
  // AdView
  'adview.com':              '1b2cc038a11ea319',
  // Mintegral
  'mintegral.com':           '0aeed750c80d6423',
  // Triton Digital
  'tritondigital.com':       '19b4454d0b87b58b',
  // IMDS
  'imds.tv':                 'ae6c32151e71f19d',
  // ConnectAd
  'connectad.io':            '85ac85a30c93b3e5',
  // PubWise
  'pubwise.io':              'c327c91a93a7cdd3',
  // Axonix
  'axonix.com':              'bc385f2b4a87b721',
  // IION
  'iion.io':                 '013a29748465dc57',
  // TopOnAd
  'toponad.com':             '1d49fe424a1a456d',
  // TVP
  'tvp.tv':                  '1125b6434104a723',
  // ACEex
  'aceex.io':                'b1cf3c874d5c6682',
  // POKKT
  'pokkt.com':               'c45702d9311e25fd',
  // Hindsight Solutions
  'hindsightsolutions.net':  '20e30b2ae1f670f2',
  // BizzClick
  'bizzclick.com':           '7e936b1feafdaa61',
  // Blis
  'blis.com':                '61453ae19a4b73f4',
  // Bold Win
  'bold-win.com':            '71746737d0bab951',
  // Adyoulike
  'adyoulike.com':           '4ad745ead2958bf7',
  // Keenkale
  'keenkale.com':            '6c1c00b269ccdfa4',
  // xAd / GroundTruth
  'xad.com':                 '81cbf0a75a5e0e9a',
}

const SEVERITY_RANK = { error: 4, warning: 3, duplicate: 2, filled: 1, corrected: 0 }

function worstOf(a, b) {
  if (!a) return b
  if (!b) return a
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b
}

export function validateAdsTxt(content) {
  const lines = content.split('\n')
  const correctedLines = []
  const outputLineStatuses = []
  const issues = []
  const inputLineIssues = new Map()
  const seenRecords = new Set()
  const seenDomains = new Set()
  const records = []
  const variables = {}
  let totalRecords = 0
  let keptRecords = 0
  let duplicatesRemoved = 0
  let certsAdded = 0
  let directCount = 0
  let resellerCount = 0

  const pushIssue = (issue) => {
    issues.push(issue)
    if (issue.lineNumber > 0) {
      inputLineIssues.set(
        issue.lineNumber,
        worstOf(inputLineIssues.get(issue.lineNumber), issue.severity)
      )
    }
  }

  lines.forEach((line, idx) => {
    const lineNumber = idx + 1
    const stripped = line.trim()

    if (!stripped || stripped.startsWith('#')) {
      correctedLines.push(line)
      outputLineStatuses.push(null)
      return
    }

    // BUG-03 FIX: Variable declarations only when '=' appears before first comma (or no comma at all).
    // Previously, records like "foo.com, 1234=abc, DIRECT" would incorrectly route here.
    const firstComma = stripped.indexOf(',')
    const firstEquals = stripped.indexOf('=')
    if (
      firstEquals !== -1 &&
      (firstComma === -1 || firstEquals < firstComma) &&
      !stripped.startsWith('http')
    ) {
      const varName = stripped.slice(0, firstEquals).trim().toUpperCase()
      const value = stripped.slice(firstEquals + 1).trim()

      if (!SUPPORTED_VARIABLES.has(varName)) {
        pushIssue({
          severity: 'warning', lineNumber,
          message: `Unsupported variable '${varName}'.`,
          original: stripped,
          suggestion: `Valid variables: ${[...SUPPORTED_VARIABLES].sort().join(', ')}`
        })
        correctedLines.push(line)
        outputLineStatuses.push('warning')
        return
      }

      if (varName === 'OWNERDOMAIN' && variables[varName]) {
        pushIssue({
          severity: 'warning', lineNumber,
          message: `Multiple OWNERDOMAIN declarations — only one is allowed per spec.`,
          original: stripped,
          suggestion: `Remove this line and keep only one OWNERDOMAIN declaration.`
        })
      }

      variables[varName] = value
      const corrected = `${varName}=${value}`
      correctedLines.push(corrected)
      outputLineStatuses.push(corrected !== stripped ? 'corrected' : null)
      return
    }

    // Data records
    totalRecords++

    let extensionData = ''
    let mainPart = stripped
    if (stripped.includes(';')) {
      const semiIdx = stripped.indexOf(';')
      mainPart = stripped.slice(0, semiIdx)
      extensionData = stripped.slice(semiIdx)
    }

    const parts = mainPart.split(',').map(p => p.trim())

    if (parts.length < 3) {
      pushIssue({
        severity: 'error', lineNumber,
        message: `Invalid format — needs at least 3 fields (domain, publisher_id, relationship), got ${parts.length}.`,
        original: stripped,
        suggestion: `Example: google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0`
      })
      correctedLines.push(line)
      outputLineStatuses.push('error')
      return
    }

    const domain = parts[0].toLowerCase()
    // BUG-02 FIX: Preserve original publisher ID case in output; lowercase only for comparison.
    const publisherIdRaw = parts[1]
    const publisherIdLower = publisherIdRaw.toLowerCase()
    const relationship = parts[2].toUpperCase()
    // BUG-04 FIX: Normalize cert ID to lowercase throughout.
    const rawCertLower = parts[3] ? parts[3].trim().toLowerCase() : ''

    // Pre-fill cert for dedup so that "record without cert" and "same record with cert"
    // are correctly treated as duplicates (previously they'd get different keys).
    const knownCert = DOMAIN_TO_CERT[domain] ?? ''
    const certForDedup = rawCertLower || knownCert

    // BUG-01 FIX: Include relationship in duplicate key.
    // Previously DIRECT and RESELLER for the same domain/publisher were wrongly merged.
    const recordKey = `${domain}|${publisherIdLower}|${relationship}|${certForDedup}`
    if (seenRecords.has(recordKey)) {
      pushIssue({
        severity: 'duplicate', lineNumber,
        message: `Duplicate removed: ${domain}, ${publisherIdRaw}, ${relationship}${certForDedup ? ', ' + certForDedup : ''}.`,
        original: stripped,
        suggestion: null
      })
      duplicatesRemoved++
      return
    }
    seenRecords.add(recordKey)
    seenDomains.add(domain)

    const lineIssues = []
    let certId = rawCertLower
    let certWasFilled = false

    if (!DOMAIN_REGEX.test(domain)) {
      lineIssues.push({
        severity: 'error', lineNumber,
        message: `Invalid domain '${domain}'.`,
        original: stripped,
        suggestion: `Check for typos, invalid characters, or missing TLD (e.g. 'google.com' not 'google').`
      })
    }

    if (!publisherIdRaw.trim()) {
      lineIssues.push({
        severity: 'error', lineNumber,
        message: `Empty publisher account ID (field 2).`,
        original: stripped,
        suggestion: `Add the publisher account ID provided by the ad network.`
      })
    }

    if (relationship !== 'DIRECT' && relationship !== 'RESELLER') {
      const lower = parts[2].toLowerCase()
      const guess = lower.includes('direct') ? 'DIRECT' : lower.includes('resell') ? 'RESELLER' : null
      lineIssues.push({
        severity: 'error', lineNumber,
        message: `Invalid relationship '${relationship}' — must be DIRECT or RESELLER.`,
        original: stripped,
        suggestion: guess
          ? `Change to: ${domain}, ${publisherIdRaw}, ${guess}${certId ? ', ' + certId : ''}`
          : `Replace '${parts[2]}' with either DIRECT or RESELLER.`
      })
    } else {
      if (relationship === 'DIRECT') directCount++
      else resellerCount++
    }

    if (certId) {
      // Stricter validation: TAG cert IDs must be exactly 16 lowercase hex characters.
      if (!TAG_CERT_REGEX.test(certId)) {
        lineIssues.push({
          severity: 'error', lineNumber,
          message: `Cert ID '${certId}' is invalid — TAG cert IDs must be exactly 16 lowercase hex characters.`,
          original: stripped,
          suggestion: `Verify the cert ID with your ad network or remove it if uncertain.`
        })
      } else if (!VALID_CA_IDS[certId]) {
        lineIssues.push({
          severity: 'warning', lineNumber,
          message: `Cert ID '${certId}' not found in known TAG registry — may still be valid.`,
          original: stripped,
          suggestion: `Verify this cert ID with the ad network directly.`
        })
      }
    } else if (knownCert) {
      certId = knownCert
      certWasFilled = true
      certsAdded++
      lineIssues.push({
        severity: 'filled', lineNumber,
        message: `Cert ID added: ${knownCert} — ${VALID_CA_IDS[knownCert]}.`,
        original: stripped,
        suggestion: null
      })
    }

    lineIssues.forEach(i => pushIssue(i))

    const worstLineSeverity = lineIssues.reduce((w, i) => worstOf(w, i.severity), null)

    const wasCorrected = !certWasFilled && (
      parts[0] !== domain ||
      parts[2] !== relationship ||
      (parts[3] && parts[3].trim() !== certId)
    )

    keptRecords++
    // BUG-02 FIX: Use publisherIdRaw (original case) in output, not lowercased version.
    const recordParts = [domain, publisherIdRaw, relationship]
    if (certId) recordParts.push(certId)
    correctedLines.push(recordParts.join(', ') + extensionData)
    outputLineStatuses.push(worstLineSeverity ?? (wasCorrected ? 'corrected' : null))

    records.push({ domain, publisherId: publisherIdRaw, relationship, certId, extensions: extensionData, lineNumber })
  })

  // BUG-05 FIX: Use lineNumber -1 (not 0) so the "Line 0" label never renders in the UI.
  if (totalRecords === 0 && Object.keys(variables).length === 0) {
    pushIssue({
      severity: 'error', lineNumber: -1,
      message: 'File contains no valid data records or variable declarations.',
      original: '',
      suggestion: `Each record should follow: domain.com, PUBLISHER_ID, DIRECT|RESELLER[, CERT_ID]`
    })
  }

  return {
    cleanedContent: correctedLines.join('\n'),
    outputLineStatuses,
    inputLineIssues,
    issues,
    records,
    stats: {
      totalRecords,
      keptRecords,
      errors: issues.filter(i => i.severity === 'error').length,
      warnings: issues.filter(i => i.severity === 'warning').length,
      duplicatesRemoved,
      certsAdded,
      directCount,
      resellerCount,
    },
    coverage: {
      present: TOP_NETWORKS.filter(n => seenDomains.has(n.domain)),
      missing: TOP_NETWORKS.filter(n => !seenDomains.has(n.domain)),
    }
  }
}
