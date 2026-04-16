const DOMAIN_REGEX = /^(?=.{1,253}$)(?!-)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/

const SUPPORTED_VARIABLES = new Set([
  'CONTACT', 'SUBDOMAIN', 'INVENTORYPARTNERDOMAIN', 'OWNERDOMAIN', 'MANAGERDOMAIN'
])

const VALID_CA_IDS = {
  'f08c47fec0942fa0': 'Google (Authorized Buyers)',
  '7842df1d2fe2db34': 'Google AdSense / AdMob',
  'e1a5b5b704a45b4e': 'Xandr / Verizon Media',
  '5d62403b186f2ace': 'OpenX',
  '1ad675c9de6b5176': 'PubMatic',
  '50b1c356f2c5c8fc': 'Index Exchange',
  '0bfd66d529a55807': 'Magnite (Rubicon Project)',
  '3fd707be9c4527c3': 'Criteo',
  'fafdf38b16bf6b2b': 'Sovrn / Lijit',
  '6a92c77cfc3d2258': 'TripleLift',
  '6c33edb13117fd86': 'TripleLift',
  'd53b998a7bd4ecd2': 'Sharethrough',
  '18e5c4a0b8280590': 'Amazon Publisher Services',
  '07bcf65f187117b4': 'Smaato',
  'a670e2c36b2c2a9d': 'IronSource',
  'c228e6794e811952': 'Unity Ads',
  '59c49ff303f41b7f': 'Fyber (Digital Turbine)',
  'a2765ed5dbc692ec': 'MoPub (Twitter)',
  '4c559b06b9b9483b': 'Vungle (Liftoff)',
  '1d7d3d9a5c42f0db': 'AdColony',
  '9e1ce09b7cb0e6e8': 'InMobi',
  'c09acac31a81d462': 'Chartboost',
  '7118c6312e0b7d84': 'AppLovin',
  '9fac4a4a87c2a44f': 'Criteo',
  '03113cd04947736d': 'Conversant Media',
  '89ff185a4c4e857c': 'PulsePoint (ContextWeb)',
  'c1ba615865ed87b2': 'E-Planning',
  'd641df8625486a7b': 'PubNative',
  'd1a215d9eb5aee9e': 'Sonobi',
  '6c8d5f95897a5a3b': 'LoopMe',
  '35d5010d7789b49d': 'The Media Grid',
  '83e75a7ae333ca9d': 'InMobi',
  '5529a3d1f59865be': 'MobFox',
  '060d053dcf45cbf3': 'Smart AdServer',
  '9f5210a2f0999e32': 'Adform',
  '81cbf0a75a5e0e9a': 'xAd / GroundTruth',
  'f5ab79cb980f11d1': 'AppNexus / Xandr',
  'bbea06d9c4d2853c': '33Across',
  'e1a5b5b6e3255540': 'Yahoo',
  '6a698e2ec38604c6': 'OpenX',
  '55a0c5fd61378de3': 'Opera',
  'b6ada874b4d7d0b2': 'Vidazoo',
  '064bc410192443d8': 'Video Heroes',
  'c25b2154543746ac': 'The Brave',
  'd4c29acad76ce94f': 'MGID',
  '1e1d41537f7cad7f': 'EMX Digital',
  'aefcd3d2f45b5070': 'Consumable',
  '524ecb396915caaf': 'Luna Media',
  '5b394c12fea27a1d': 'Algorix',
  '1b2cc038a11ea319': 'AdView',
  'e2541279e8e2ca4d': 'Beachfront',
  '0aeed750c80d6423': 'Mintegral',
  'c3e20eee3f780d68': 'Facebook / Meta',
  '19b4454d0b87b58b': 'Triton Digital',
  'ae6c32151e71f19d': 'IMDS',
  '7e936b1feafdaa61': 'BizzClick',
  '61453ae19a4b73f4': 'Blis',
  '71746737d0bab951': 'Bold Win',
  '85ac85a30c93b3e5': 'ConnectAd',
  '4ad745ead2958bf7': 'Adyoulike',
  'c327c91a93a7cdd3': 'PubWise',
  'bc385f2b4a87b721': 'Axonix',
  '013a29748465dc57': 'IION',
  '1d49fe424a1a456d': 'TopOnAd',
  '6f752381ad5ec0e5': 'Unruly Media',
  '1125b6434104a723': 'TVP',
  'b1cf3c874d5c6682': 'ACEex',
  'c45702d9311e25fd': 'POKKT',
  '20e30b2ae1f670f2': 'Hindsight Solutions',
  'd954590d0cb265b9': 'Undertone',
  'e2541279e8e2ca4d': 'Beachfront',
}

export function validateAdsTxt(content) {
  const lines = content.split('\n')
  const correctedLines = []
  const issues = []
  const seenRecords = new Set()
  const variables = {}
  let totalRecords = 0
  let keptRecords = 0
  let duplicatesRemoved = 0

  lines.forEach((line, idx) => {
    const lineNumber = idx + 1
    const stripped = line.trim()

    if (!stripped || stripped.startsWith('#')) {
      correctedLines.push(line)
      return
    }

    // Variable declarations: KEY=VALUE (not a URL)
    if (stripped.includes('=') && !stripped.startsWith('http')) {
      const eqIdx = stripped.indexOf('=')
      const varName = stripped.slice(0, eqIdx).trim().toUpperCase()
      const value = stripped.slice(eqIdx + 1).trim()

      if (!SUPPORTED_VARIABLES.has(varName)) {
        issues.push({
          severity: 'warning',
          lineNumber,
          message: `Unsupported variable '${varName}'.`,
          original: stripped,
          suggestion: `Valid variables: ${[...SUPPORTED_VARIABLES].sort().join(', ')}`
        })
        correctedLines.push(line)
        return
      }

      if (varName === 'OWNERDOMAIN' && variables[varName]) {
        issues.push({
          severity: 'warning',
          lineNumber,
          message: `Multiple OWNERDOMAIN declarations — only one is allowed per spec. First value is used.`,
          original: stripped,
          suggestion: `Remove this line and keep only one OWNERDOMAIN declaration.`
        })
      }

      variables[varName] = value
      correctedLines.push(`${varName}=${value}`)
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
      issues.push({
        severity: 'error',
        lineNumber,
        message: `Invalid format — needs at least 3 fields (domain, publisher_id, relationship), got ${parts.length}.`,
        original: stripped,
        suggestion: `Example: google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0`
      })
      return
    }

    const domain = parts[0].toLowerCase()
    const publisherId = parts[1].toLowerCase()
    const relationship = parts[2].toUpperCase()
    const certId = parts[3] ? parts[3].trim() : ''

    // Duplicate check (domain + publisherId + certId)
    const recordKey = `${domain}|${publisherId}|${certId}`
    if (seenRecords.has(recordKey)) {
      issues.push({
        severity: 'duplicate',
        lineNumber,
        message: `Duplicate removed: ${domain}, ${publisherId}${certId ? ', ' + certId : ''}.`,
        original: stripped,
        suggestion: null
      })
      duplicatesRemoved++
      return
    }
    seenRecords.add(recordKey)

    const lineIssues = []

    if (!DOMAIN_REGEX.test(domain)) {
      lineIssues.push({
        severity: 'error',
        lineNumber,
        message: `Invalid domain '${domain}' — must be a valid hostname.`,
        original: stripped,
        suggestion: `Check for typos, invalid characters, or missing TLD (e.g. use 'google.com' not 'google').`
      })
    }

    if (!publisherId) {
      lineIssues.push({
        severity: 'error',
        lineNumber,
        message: `Empty publisher account ID (field 2).`,
        original: stripped,
        suggestion: `Add the publisher account ID provided by the ad network.`
      })
    }

    if (relationship !== 'DIRECT' && relationship !== 'RESELLER') {
      const lower = parts[2].toLowerCase()
      const guess = lower.includes('direct') ? 'DIRECT' : lower.includes('resell') ? 'RESELLER' : null
      lineIssues.push({
        severity: 'error',
        lineNumber,
        message: `Invalid relationship '${relationship}' — must be DIRECT or RESELLER.`,
        original: stripped,
        suggestion: guess
          ? `Change '${parts[2]}' to '${guess}': ${domain}, ${publisherId}, ${guess}${certId ? ', ' + certId : ''}`
          : `Replace '${parts[2]}' with either DIRECT or RESELLER.`
      })
    }

    if (certId) {
      if (!/^[a-zA-Z0-9_-]+$/.test(certId)) {
        const cleaned = certId.replace(/[^a-zA-Z0-9_-]/g, '')
        lineIssues.push({
          severity: 'error',
          lineNumber,
          message: `Certification ID '${certId}' contains invalid characters.`,
          original: stripped,
          suggestion: `Remove invalid characters: ${domain}, ${publisherId}, ${relationship}, ${cleaned}`
        })
      } else {
        const caName = VALID_CA_IDS[certId.toLowerCase()]
        if (!caName) {
          lineIssues.push({
            severity: 'warning',
            lineNumber,
            message: `Cert ID '${certId}' not found in known TAG registry — may still be valid.`,
            original: stripped,
            suggestion: `Verify this cert ID with the ad network directly.`
          })
        }
      }
    }

    issues.push(...lineIssues)
    keptRecords++

    const recordParts = [domain, publisherId, relationship]
    if (certId) recordParts.push(certId)
    correctedLines.push(recordParts.join(', ') + extensionData)
  })

  if (totalRecords === 0 && Object.keys(variables).length === 0) {
    issues.push({
      severity: 'error',
      lineNumber: 0,
      message: 'File contains no valid data records or variable declarations.',
      original: '',
      suggestion: `Each record should follow: domain.com, PUBLISHER_ID, DIRECT|RESELLER[, CERT_ID]`
    })
  }

  return {
    cleanedContent: correctedLines.join('\n'),
    issues,
    stats: {
      totalRecords,
      keptRecords,
      errors: issues.filter(i => i.severity === 'error').length,
      warnings: issues.filter(i => i.severity === 'warning').length,
      duplicatesRemoved
    }
  }
}
