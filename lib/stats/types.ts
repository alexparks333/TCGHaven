// stats_daily/{day} — one doc per UTC day, written by lib/stats/aggregate.ts, read by the staff
// portal's Statistics and Finances pages. Card, account, social and title numbers are a snapshot
// taken that day; `usage` is that day's activity (final once the next day's first run has finished it).

export interface UsageTotals {
  dau: number                         // accounts active that day
  seconds: number                     // time in the app, all accounts
  sessions: number                    // app opens / returns after 30 min
  pageSeconds: Record<string, number> // time per part of the app
  pageUsers: Record<string, number>   // accounts that opened each part
  pageVisits: Record<string, number>  // times each part was opened
  appUsers: number                    // used the iPhone app
  webUsers: number                    // used the website
  appSeconds: number
  webSeconds: number
}

export interface DailyStats {
  day: string
  final: boolean
  computedAt?: unknown
  accounts: {
    total: number        // profiles
    summaries: number    // accounts that have sent a summary (opened the app since tracking began)
    signups: number      // new accounts that day
    withCards: number
    active7: number      // used in the last 7 days
    active30: number     // used in the last 30 days
    appLast: number      // last used on the iPhone app
  }
  roles: { premium: number; creator: number; staff: number; banned: number; suspended: number }
  cards: {
    total: number
    unique: number
    byGame: Record<string, number>
    uniqueByGame: Record<string, number> // accounts collecting each game
    graded: Record<string, number>       // copies per grading company
    japanese: number
    foil: number
    buckets: Record<string, number>      // accounts by collection size
    gamesPerAccount: Record<string, number> // accounts by how many games they collect (5 = 5+)
    avgPerAccount: number
    avgPerCollector: number              // average among accounts with ≥1 card
    median: number
  }
  social: { avgFriends: number; withFriend: number; avgBadges: number; withBadge: number; sold: number }
  retention: Record<'d1' | 'd7' | 'd30', { cohort: number; retained: number }>
  usage: UsageTotals
}
