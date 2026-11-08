// The shapes plugins answer, by their JSON names, as MyGo Music's
// internal/music/music.go has them. Times are in milliseconds.

export interface Artist {
  id: string
  name: string
  imageUrl?: string
  following?: boolean
}

export interface Album {
  id: string
  name: string
  imageUrl?: string
  artists?: Artist[]
  released?: string
  saved?: boolean
}

export interface Track {
  id: string
  /** The plugin it came from, which the server stamps on it. */
  source?: string
  name: string
  artists?: Artist[]
  album: Album
  duration: number
  url?: string
  unavailable?: boolean
  showId?: string
  description?: string
  published?: string
}

export interface Playlist {
  id: string
  name: string
  imageUrl?: string
  description?: string
  owner?: string
  trackCount?: number
  mine?: boolean
  saved?: boolean
  fixed?: boolean
  tracks?: Track[]
}

export interface ArtistPage {
  artist: Artist
  tracks?: Track[]
  albums?: Album[]
}

export interface AlbumPage {
  album: Album
  tracks?: Track[]
}

export interface Account {
  id: string
  name: string
  imageUrl?: string
  page?: string
}

export type SearchKind = 'tracks' | 'albums' | 'artists' | 'playlists' | 'shows'

export interface SearchResult {
  tracks?: Track[]
  albums?: Album[]
  artists?: Artist[]
  playlists?: Playlist[]
  shows?: Show[]
  more?: boolean
}

export interface Page {
  tracks?: Track[]
  more?: boolean
}

export interface AlbumList {
  albums?: Album[]
  more?: boolean
}

export interface Show {
  id: string
  name: string
  imageUrl?: string
  description?: string
  publisher?: string
  publisherPage?: string
  episodeCount?: number
  subscribed?: boolean
}

export interface ShowPage {
  show: Show
  episodes?: Track[]
  more?: boolean
}

export interface Station {
  id: string
  name: string
  description?: string
  imageUrl?: string
}

export interface Comment {
  id: string
  author: string
  avatarUrl?: string
  text: string
  time?: number
  likes?: number
  liked?: boolean
}

export interface CommentPage {
  comments?: Comment[]
  total?: number
  more?: boolean
}

export interface Link {
  title: string
  subtitle?: string
  imageUrl?: string
  page: string
}

export interface Section {
  title?: string
  tracks?: Track[]
  albums?: Album[]
  artists?: Artist[]
  playlists?: Playlist[]
  shows?: Show[]
  stations?: Station[]
  links?: Link[]
  morePage?: string
  empty?: string
  pageTitle?: string
  subtitle?: string
}

export interface Browse {
  title?: string
  subtitle?: string
  imageUrl?: string
  description?: string
  sections?: Section[]
}

export interface NavItem {
  title?: string
  page?: string
  builtin?: 'home' | 'liked' | 'savedAlbums' | 'stations' | 'shows'
  icon?: string
}

export interface Stream {
  url: string
  type: string
  quality?: string
  bitRate?: number
  size?: number
  peak?: number
  gain?: number
  headers?: Record<string, string>
}

export interface LyricWord {
  start: number
  end: number
  text: string
}

export interface LyricLine {
  start: number
  end?: number
  text?: string
  translation?: string
  words?: LyricWord[]
}

export interface Lyrics {
  lrc?: string
  translation?: string
  lines?: LyricLine[]
}

export interface Device {
  id: string
  name: string
  active?: boolean
}

export interface RemoteState {
  playing: boolean
  trackId?: string
  position: number
  duration: number
  volume: number
  device?: string
}

export type Playback = 'stream' | 'remote'

export interface Setting {
  key: string
  label: string
  help?: string
  link?: string
}

export interface RequestHeaders {
  hosts: string[]
  kinds?: ('image' | 'audio')[]
  headers: Record<string, string>
}

export interface Manifest {
  id: string
  name: string
  version?: string
  playback?: Playback
  settings?: Setting[]
  navigation?: NavItem[]
  main?: string
  minAppVersion?: string
  permissions?: {
    network?: string[]
    process?: string[] | boolean
  }
  requestHeaders?: RequestHeaders[]
}

export interface SignInPrompt {
  qr?: string
  text?: string
}

/** Errors a plugin throws with a code, which the app does something about. */
export type FailCode = 'signIn' | 'setup' | 'unavailable' | 'unsupported'

/** Every function a plugin can export, by the names the app calls. */
export const SOURCE_METHODS = [
  'signIn', 'signOut', 'account', 'setSetting',
  'home', 'browse', 'search', 'suggest', 'recent', 'played',
  'liked', 'isLiked', 'like', 'likeEpisode',
  'album', 'artist', 'saveAlbum', 'followArtist', 'savePlaylist', 'subscribeShow', 'savedAlbums',
  'playlists', 'playlist', 'createPlaylist', 'renamePlaylist', 'deletePlaylist',
  'addToPlaylist', 'removeFromPlaylist', 'movePlaylistTrack',
  'shows', 'show', 'stations', 'stationNext',
  'comments', 'likeComment', 'postComment',
  'lyrics', 'stream',
  'remotePlay', 'remotePause', 'remoteResume', 'remoteSeek', 'remoteVolume',
  'remoteState', 'remoteDevices', 'remoteUse',
] as const
export type SourceMethod = (typeof SOURCE_METHODS)[number]

// ---- What the server answers the web app ----

export interface SourceInfo {
  id: string
  name: string
  version?: string
  playback: Playback
  settings: Setting[]
  navigation: NavItem[]
  /** The functions the plugin exports. */
  caps: string[]
  /** The listener turned it on for themselves. */
  enabled: boolean
  /** What the listener filled in, by setting key. */
  values: Record<string, string>
  /** Hosts whose pictures go through the server, for the headers they need. */
  imageHosts: string[]
  locales: Record<string, Record<string, string>>
  network: string[]
  repo?: string
}

export interface Me {
  id: string
  name: string
  avatar?: string
  admin: boolean
  authMode: 'oidc' | 'none'
}

export interface PlayableStream extends Stream {
  /** Where the browser plays it from: the plugin's address, or the server's. */
  playUrl: string
}

export interface AdminPlugin {
  id: string
  name: string
  version?: string
  repo?: string
  route: 'direct' | 'proxy' | 'global'
  enabled: boolean
  network: string[]
  error?: string
  installedAt: number
}

export interface PluginPreview {
  stagingId: string
  manifest: Manifest
  replaces?: string
  version?: string
}

export type HostEvent =
  | { kind: 'signInPrompt'; source: string; prompt: SignInPrompt }
  | { kind: 'openURL'; source: string; url: string }
  | { kind: 'webSignIn'; source: string; reqId: string; url: string; cookiesOf: string; until: string[] }
  | { kind: 'waitForRedirect'; source: string; reqId: string; port: number; path: string }
  | { kind: 'answered'; source: string; reqId: string }
  | { kind: 'signedIn'; source: string; account: Account | null }
  | { kind: 'signInFailed'; source: string; error: { code?: string; message: string } }

/** The app's version that plugins' minAppVersion is checked against. */
export const COMPAT_VERSION = '0.1.22'
