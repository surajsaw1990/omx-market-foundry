/**
 * Synthetic "Demo Wire" feed. Dates are generated relative to the fetch time so the demo always
 * contains upcoming events. The articles are clearly marked synthetic and deliberately cover the
 * interesting cases: a clean candidate, two reports of the same event with conflicting dates, a
 * story duplicating a live market, an opinion piece, and a photo gallery that should be filtered.
 */
import type { RawFeedItem } from "./types";

const DAY = 86_400_000;

function at(now: Date, days: number, hourUtc = 18): Date {
  const d = new Date(now.getTime() + days * DAY);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d;
}

export function fmtLong(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Last day of the month that is `monthsAhead` months after `now`. */
export function monthEnd(now: Date, monthsAhead: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthsAhead + 1, 0, 23, 59, 0));
}

export function fixtureItems(now: Date = new Date()): RawFeedItem[] {
  const fomc = at(now, 14);
  const starship1 = at(now, 9, 13);
  const starship2 = at(now, 16, 13);
  const euVote = at(now, 20, 11);
  const ipo = at(now, 12, 14);
  const test = at(now, 6, 0);
  const btcDate = monthEnd(now, 1);
  const published = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();
  const base = "https://demo-wire.example/articles";

  return [
    {
      externalId: "demo-fomc",
      url: `${base}/fed-rate-decision-preview`,
      title: `Federal Reserve set to announce interest-rate decision on ${fmtLong(fomc)}`,
      summary: `The Federal Open Market Committee will conclude its two-day policy meeting on ${fmtLong(fomc)} and publish its statement at 2:00 p.m. ET on the Federal Reserve website. Futures pricing implies roughly a 60% probability of a 25 basis-point cut to the federal funds target range, while several regional bank presidents have argued for holding rates steady until inflation data improves. [Synthetic demo article]`,
      publishedAt: published(3),
    },
    {
      externalId: "demo-starship-1",
      url: `${base}/starship-flight-test-date`,
      title: `SpaceX targets ${fmtLong(starship1)} for next Starship flight test, pending FAA approval`,
      summary: `SpaceX said it is targeting ${fmtLong(starship1)} for the next integrated flight test of Starship from Starbase, Texas. The launch still requires a modified launch licence from the Federal Aviation Administration, which has not yet been issued. The company will stream the attempt on spacex.com. [Synthetic demo article]`,
      publishedAt: published(8),
    },
    {
      externalId: "demo-starship-2",
      url: `${base}/starship-test-slips`,
      title: `Starship flight test slips to ${fmtLong(starship2)}, people familiar with the plan say`,
      summary: `The next Starship integrated flight test is now expected no earlier than ${fmtLong(starship2)}, according to two people familiar with the schedule, after additional ground testing of the upper stage. SpaceX has not updated its public target date and the FAA licence modification remains pending. [Synthetic demo article]`,
      publishedAt: published(2),
    },
    {
      externalId: "demo-btc",
      url: `${base}/bitcoin-etf-inflows`,
      title: "Bitcoin climbs toward $150,000 as spot ETF inflows accelerate",
      summary: `Bitcoin rose 4% to trade near $141,000 as US spot bitcoin ETFs recorded a fifth straight week of net inflows. Options traders are increasingly positioning for Bitcoin to close above $150,000 on ${fmtLong(btcDate)}, the end of next month, according to derivatives data. [Synthetic demo article]`,
      publishedAt: published(5),
    },
    {
      externalId: "demo-eu-ai",
      url: `${base}/eu-ai-liability-vote`,
      title: `European Parliament to hold final plenary vote on AI Liability Directive on ${fmtLong(euVote)}`,
      summary: `MEPs will vote on the AI Liability Directive during the plenary session in Strasbourg on ${fmtLong(euVote)}. The text, agreed in trilogue last month, would ease the burden of proof for people harmed by AI systems. Results of plenary votes are published on the European Parliament website the same day. Some groups have signalled they may request a postponement. [Synthetic demo article]`,
      publishedAt: published(6),
    },
    {
      externalId: "demo-ipo",
      url: `${base}/nimbus-robotics-ipo`,
      title: `Nimbus Robotics expected to price Nasdaq IPO on ${fmtLong(ipo)}`,
      summary: `Warehouse-automation start-up Nimbus Robotics is expected to price its initial public offering on ${fmtLong(ipo)} and begin trading on the Nasdaq under the ticker NMBR the following morning. The company is marketing shares at $18 to $21 each. [Synthetic demo article]`,
      publishedAt: published(10),
    },
    {
      externalId: "demo-cricket",
      url: `${base}/india-australia-third-test`,
      title: `India and Australia meet in third Test starting ${fmtLong(test)} in Melbourne with series level at 1-1`,
      summary: `The five-match series is level at 1-1 heading into the third Test at the Melbourne Cricket Ground, which begins on ${fmtLong(test)}. Australia have named an unchanged XI; India are expected to recall their frontline spinner. [Synthetic demo article]`,
      publishedAt: published(4),
    },
    {
      externalId: "demo-opinion",
      url: `${base}/opinion-tech-reset`,
      title: "Opinion: The tech industry needs to slow down and rethink its priorities",
      summary: "Our columnist argues that the rush to ship AI features has left users behind and that the industry would be better served by focusing on reliability. [Synthetic demo article]",
      publishedAt: published(12),
    },
    {
      externalId: "demo-gallery",
      url: `${base}/in-pictures-lantern-festival`,
      title: "In pictures: Autumn lantern festival lights up the old town",
      summary: "Thousands gathered for the annual lantern festival. [Synthetic demo article]",
      publishedAt: published(20),
    },
  ];
}

/** Markets that are already "live" on OmniMarketX, so duplicate detection has something to hit. */
export function seedMarkets(now: Date = new Date()) {
  const btcDate = monthEnd(now, 1);
  const cpiDate = at(now, 30, 6);
  const plDate = new Date(Date.UTC(now.getUTCFullYear() + 1, 4, 24, 16));
  return [
    {
      question: `Will Bitcoin close above $150,000 on ${fmtLong(btcDate)}?`,
      category: "Crypto",
      eventDate: btcDate.toISOString(),
      resolutionSource: { name: "CoinGecko BTC/USD daily close", url: "https://www.coingecko.com/en/coins/bitcoin" },
    },
    {
      question: `Will UK CPI inflation for last month be reported above 3.5% on ${fmtLong(cpiDate)}?`,
      category: "Economics",
      eventDate: cpiDate.toISOString(),
      resolutionSource: { name: "Office for National Statistics", url: "https://www.ons.gov.uk/economy/inflationandpriceindices" },
    },
    {
      question: `Will Arsenal win the ${now.getUTCFullYear()}–${String(now.getUTCFullYear() + 1).slice(2)} Premier League title?`,
      category: "Sports",
      eventDate: plDate.toISOString(),
      resolutionSource: { name: "Premier League", url: "https://www.premierleague.com/tables" },
    },
  ];
}
