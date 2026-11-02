import { XMLParser } from 'fast-xml-parser'
import { SaxesParser } from 'saxes'

// Preserve the tree until namespace declarations have been resolved. A global
// prefix-stripping option cannot distinguish foreign elements or scoped aliases.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: true,
  preserveOrder: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
})

type XmlNode = Record<string, unknown>
type NamespaceMap = Record<string, string>
// The XML parser exposes a dynamic document boundary; retain its return type
// while converting ordered nodes into the compact shape consumed by parsers.
type XmlDocument = ReturnType<XMLParser['parse']>

const GPX_NAMESPACES = new Set(['http://www.topografix.com/GPX/1/0', 'http://www.topografix.com/GPX/1/1'])
const TCX_NAMESPACES = new Set([
  'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v1',
  'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2',
])
const EXTENSIONS = new Map([
  ['http://www.garmin.com/xmlschemas/TrackPointExtension/v1', 'gpxtpx:'],
  ['http://www.garmin.com/xmlschemas/TrackPointExtension/v2', 'gpxtpx:'],
  ['http://www.garmin.com/xmlschemas/ActivityExtension/v1', 'ns3:'],
  ['http://www.garmin.com/xmlschemas/ActivityExtension/v2', 'ns3:'],
])

function bindings(node: XmlNode, inherited: NamespaceMap): NamespaceMap {
  const namespaces: NamespaceMap = Object.assign(Object.create(null), inherited)
  for (const [name, value] of Object.entries((node[':@'] ?? {}) as XmlNode)) {
    if (name === '@_xmlns') namespaces[''] = String(value)
    else if (name.startsWith('@_xmlns:')) namespaces[name.slice(8)] = String(value)
  }
  return namespaces
}

function elementName(node: XmlNode): string | undefined {
  return Object.keys(node).find(key => key !== ':@' && key !== '#text')
}

function expandedName(name: string, namespaces: NamespaceMap): { local: string; uri?: string } {
  const colon = name.indexOf(':')
  return colon < 0 ? { local: name, uri: namespaces[''] }
    : { local: name.slice(colon + 1), uri: namespaces[name.slice(0, colon)] }
}

function compact(nodes: XmlNode[], inherited: NamespaceMap, base: Set<string>): XmlDocument {
  const result: XmlDocument = Object.create(null)
  for (const node of nodes) {
    const rawName = elementName(node)
    if (rawName == null) continue
    const namespaces = bindings(node, inherited)
    const { local, uri } = expandedName(rawName, namespaces)
    // Keep legacy unbound prefixes intact (older exports omit declarations).
    // Bound prefixes are always interpreted using their URI, including rebindings.
    const name = uri ? (base.has(uri) ? local : `${EXTENSIONS.get(uri) ?? `{${uri}}`}${local}`) : rawName
    const children = node[rawName] as XmlNode[]
    const fields = compact(children, namespaces, base)
    for (const [attribute, value] of Object.entries((node[':@'] ?? {}) as XmlNode)) {
      if (attribute === '@_xmlns' || attribute.startsWith('@_xmlns:')) continue
      // Default namespaces do not apply to unprefixed attributes.
      const rawAttribute = attribute.slice(2)
      const colon = rawAttribute.indexOf(':')
      const attributeUri = colon < 0 ? undefined : namespaces[rawAttribute.slice(0, colon)]
      fields[attributeUri ? `@_{${attributeUri}}${rawAttribute.slice(colon + 1)}` : attribute] = value
    }
    const textNodes = children.filter(child => '#text' in child).map(child => child['#text'])
    const text = textNodes.length === 1 ? textNodes[0] : textNodes.map(String).join('')
    const value = Object.keys(fields).length === 0 ? text : fields
    if (value === fields && textNodes.length > 0) fields['#text'] = text
    if (Object.hasOwn(result, name)) {
      if (!Array.isArray(result[name])) result[name] = [result[name]]
      result[name].push(value)
    } else result[name] = value
  }
  return result
}

export function parseXml(xml: string): XmlDocument {
  try {
    // Pinned for strict XML syntax and Node 18/browser compatibility. See the
    // dependency maintenance decision in docs/development.md.
    // Namespace interpretation stays in the scoped adapter below, preserving
    // legacy undeclared Garmin prefixes during syntax validation.
    new SaxesParser({ xmlns: false }).write(xml).close()
  } catch (error) {
    throw new Error(`Invalid XML: ${error instanceof Error ? error.message : String(error)}`)
  }
  const nodes = parser.parse(xml) as XmlNode[]
  const roots = nodes.filter(node => elementName(node) != null)
  if (roots.length !== 1) throw new Error('Invalid XML: expected exactly one root element.')
  const root = roots[0]
  const rootName = root && elementName(root)
  const rootInfo = root && rootName ? expandedName(rootName, bindings(root, {})) : undefined
  const base = rootInfo && (rootInfo.local === 'TrainingCenterDatabase' || TCX_NAMESPACES.has(rootInfo.uri ?? ''))
    ? TCX_NAMESPACES : GPX_NAMESPACES
  return compact(nodes, {}, base)
}
