/** Editorial seed content for a fresh install. */

export interface SeedUser {
  name: string;
  email: string;
  password: string;
  role: 'admin' | 'editor' | 'author';
  bio: string;
  avatar?: string | null;
  website?: string;
  twitter?: string;
}

export const SEED_USERS: SeedUser[] = [
  {
    name: 'Avery Cole',
    email: 'admin@azuregravy.local',
    password: 'gravy123',
    role: 'admin',
    bio: 'Editor-in-chief at Azure Gravy. Writes about work, tools and the quiet parts of a creative life. Previously at a magazine you have probably never heard of.',
    website: 'https://example.com',
    twitter: 'averywrites',
  },
  {
    name: 'Maya Ferreira',
    email: 'maya@azuregravy.local',
    password: 'gravy123',
    role: 'editor',
    bio: 'Editor and occasional essayist. Interested in how teams actually make decisions when nobody is watching.',
    twitter: 'mayafe',
  },
  {
    name: 'Rowan Blake',
    email: 'rowan@azuregravy.local',
    password: 'gravy123',
    role: 'author',
    bio: 'Rowan writes about productivity without the shouting. Based in Lisbon, usually between two notebooks.',
  },
  {
    name: 'Ines Duarte',
    email: 'ines@azuregravy.local',
    password: 'gravy123',
    role: 'author',
    bio: 'Travel and culture writer. Believes the best stories start where the guidebook ends.',
  },
  {
    name: 'Tobias Lindqvist',
    email: 'tobias@azuregravy.local',
    password: 'gravy123',
    role: 'author',
    bio: 'Engineer-turned-writer covering tools, craft and the economics of building software that lasts.',
  },
  {
    name: 'Priya Raman',
    email: 'priya@azuregravy.local',
    password: 'gravy123',
    role: 'author',
    bio: 'Writes about health, endurance sport and the long game. Twelve marathons, zero shortcuts.',
  },
];

export interface SeedCategory {
  name: string;
  slug: string;
  description: string;
  color: string;
  image: string;
  sort: number;
}

export const SEED_CATEGORIES: SeedCategory[] = [
  { name: 'Tech', slug: 'tech', description: 'Tools, craft and the systems we build our days around.', color: '#2f5bd7', image: '/assets/seed/categories/tech.webp', sort: 1 },
  { name: 'Startup', slug: 'startup', description: 'Small teams, early bets and the unglamorous middle of building a company.', color: '#1f7a53', image: '/assets/seed/categories/startup.webp', sort: 2 },
  { name: 'Business', slug: 'business', description: 'How good work gets funded, priced, sold and sustained.', color: '#8b5cf6', image: '/assets/seed/categories/business.webp', sort: 3 },
  { name: 'Sport', slug: 'sport', description: 'Endurance, training and what athletes know about patience.', color: '#c0392b', image: '/assets/seed/categories/sport.webp', sort: 4 },
  { name: 'Travel', slug: 'travel', description: 'Slow routes, small towns and the places between the postcards.', color: '#0e7490', image: '/assets/seed/categories/travel.webp', sort: 5 },
  { name: 'Education', slug: 'education', description: 'Learning in public, teaching well and staying curious on purpose.', color: '#b4741b', image: '/assets/seed/categories/education.webp', sort: 6 },
  { name: 'Culture', slug: 'culture', description: 'The books, habits and conversations that shape how we live.', color: '#be185d', image: '/assets/seed/categories/culture.webp', sort: 7 },
  { name: 'Health', slug: 'health', description: 'Sleep, focus and the quieter science of feeling well.', color: '#15803d', image: '/assets/seed/categories/health.webp', sort: 8 },
];

export const SEED_TAGS = [
  'deep work', 'focus', 'remote work', 'productivity', 'writing', 'design', 'leadership',
  'fundraising', 'product', 'habits', 'sleep', 'running', 'endurance', 'travel', 'slow travel',
  'learning', 'career', 'money', 'attention', 'creativity', 'teams', 'interviews',
];

export interface SeedPost {
  title: string;
  slug: string;
  category: string;
  tags: string[];
  author: string;
  excerpt: string;
  cover: string;
  daysAgo: number;
  status?: 'published' | 'draft' | 'scheduled' | 'private';
  sticky?: boolean;
  featured?: 'cover' | 'card';
  views?: number;
  content: string;
}

export const SEED_POSTS: SeedPost[] = [
  {
    title: 'The Quiet Power of Doing One Thing at a Time',
    slug: 'quiet-power-of-doing-one-thing-at-a-time',
    category: 'Business',
    tags: ['focus', 'deep work', 'productivity'],
    author: 'Rowan Blake',
    excerpt:
      'Multitasking is not a skill, it is a tax. A field guide to single-tasking your way through a week that keeps interrupting itself.',
    cover: '/assets/seed/covers/quiet-power-one-thing.webp',
    daysAgo: 2,
    sticky: true,
    views: 4821,
    content: `There is a particular kind of tiredness that comes from doing six things badly. It is different from the tiredness of doing one thing well. It is thinner, more anxious, and it does not come with the small satisfaction of having finished something.

Most of us know this. We still open the other tab.

## The tax nobody invoices

Every time you switch tasks, part of your attention stays behind. Researchers call it *attention residue*: a residue of the previous task that clings to the new one for minutes, sometimes longer. Ten switches before lunch is not ten fresh starts. It is one long, interrupted attempt to think.

> The cost of multitasking is not the time it takes to switch. It is the depth you never reach because you keep leaving.

The practical fix is not a new app. It is a smaller unit of work, defended for longer.

## A week of one thing

I ran an experiment for five working days. Each morning I picked **one** outcome — not a list, an outcome — and wrote it on a card. Everything else went into a "later" column that I was not allowed to look at before 3pm.

- Monday: finish the draft that had been open for eleven days.
- Tuesday: two hours of interviews, then nothing but notes.
- Wednesday: the pricing page, end to end.
- Thursday: reply to every email that actually needed a reply.
- Friday: a long, boring walk with no headphones.

The results were not dramatic. The draft got finished. The pricing page shipped. Nothing exploded while I ignored Slack for ninety minutes.

But something subtler changed: I stopped carrying the whole week in my head at once. One card meant one thing to hold.

## The mechanics that actually help

Single-tasking is less about willpower and more about removing the decisions that invite switching.

1. **Close the loop in writing.** An open task in your head is a task your brain will keep checking. Put it where you trust it.
2. **Make the next action physical.** "Work on launch" is a mood. "Write the first paragraph of the announcement" is a door you can walk through.
3. **Protect the first ninety minutes.** Whatever the internet wants from you, it can wait until the coffee is cold.
4. **Batch the shallow work.** Email is not evil; it is just a different mode. Give it a window instead of a permanent seat at the table.

## What it is really about

Doing one thing at a time is not a productivity hack. It is a statement about what deserves your attention, made small enough to keep.

The week does not get longer. It gets quieter. And in that quiet, the work you actually care about finally has room to arrive.

![A team working quietly in a shared studio](/assets/seed/cards/quiet-power-one-thing.webp "The studio at 9am, before the calendar wakes up")

Try it for a single morning. One card, one outcome, one tab. If it fails, you have lost three hours. If it works, you have found a way to work that does not require you to be someone else.`,
  },
  {
    title: 'What Travel Teaches You About Culture and Life',
    slug: 'what-travel-teaches-about-culture-and-life',
    category: 'Travel',
    tags: ['travel', 'slow travel', 'learning'],
    author: 'Ines Duarte',
    excerpt: 'Not the postcard version. The one about standing in a supermarket queue in a language you barely speak.',
    cover: '/assets/seed/covers/what-travel-teaches.webp',
    daysAgo: 5,
    featured: 'cover',
    views: 3610,
    content: `The most useful thing I have learned while travelling did not happen at a landmark. It happened in a laundrette in Ljubljana, where I could not work out how to pay and a stranger quietly did it for me, then left before I could say thank you properly.

Travel is often sold as scenery. It is actually a series of small, humbling lessons in how many ways a life can be arranged.

## Everything is a local custom

We talk about local customs as if they belong to other people. But the way you queue, the hour you eat, the amount of small talk you consider polite — these are customs too. You just cannot see them from inside.

Standing in a different city, you become briefly aware of your own defaults. That awareness is the actual souvenir.

> You do not travel to see how other people live. You travel to notice that you have been living one particular way, on purpose or not.

## Slowness is a skill

Fast travel optimises for coverage: four cities, six days, a camera roll of proof. Slow travel optimises for something harder to post — the moment a place stops being an image and becomes a routine.

On my third morning in a small town, the baker started making my coffee before I ordered. That was the trip. Everything before it was transit.

### Three things I now do everywhere

1. **Stay four nights minimum.** Long enough for a shop to become yours.
2. **Learn ten words.** Not to be fluent. To be less of a spectator.
3. **Take the boring walk.** The one to the pharmacy, the laundrette, the bus stop.

## Coming home is part of the trip

The strange gift of returning is that home becomes legible again. You notice the customs you grew up inside because you have just spent two weeks failing at someone else's.

I came back from that trip and rearranged my mornings. Not because Ljubljana is better than Lisbon. Because for a week I had been someone who paid attention, and I wanted to keep him around.`,
  },
  {
    title: 'A Field Guide to Deep Work in a Loud Office',
    slug: 'field-guide-to-deep-work',
    category: 'Tech',
    tags: ['deep work', 'remote work', 'focus', 'teams'],
    author: 'Tobias Lindqvist',
    excerpt: 'You cannot delete the open plan. But you can design a day that survives it — with a few honest constraints and one very boring calendar.',
    cover: '/assets/seed/covers/field-guide-deep-work.webp',
    daysAgo: 9,
    views: 2987,
    content: `Every office has a person who can concentrate anywhere. The rest of us need help. Here is the help.

## Make focus visible

The single most effective change we made was not a policy. It was a pair of headphones and a small card that says *heads down until 11*. Concentration became a thing you could see, and therefore a thing you could respect.

Remote teams need a digital version of the same card: a status, a calendar block, and a shared agreement that a blocked morning is not an invitation.

## The three-block day

Instead of one long, doomed attempt at focus, split the day into blocks with different jobs:

| Block | Length | Job |
| --- | --- | --- |
| Maker | 90 min | One hard thing, no meetings |
| Manager | 60 min | Replies, reviews, unblocking others |
| Collab | rest | Pairing, calls, decisions |

This is not a productivity religion. It is a way of telling people *when* to interrupt you, so they do not have to guess.

> Interruptions do not feel expensive in the moment. They are expensive in aggregate, and the bill arrives as a project that took twice as long.

## Write the brief first

Half of what looks like an interruption is actually an underspecified question. When a teammate has a crisp brief — the goal, the constraint, the deadline — they need you less.

We started writing a one-page brief before any project with more than two people. The number of "quick questions" dropped by roughly half. The remaining ones were better.

## Protect the seams

The minutes between meetings are where deep work goes to die. Leave fifteen-minute seams between calls. Do not schedule the moment you finish something.

## A small code example

Because this is a tech column, and because a tiny script is sometimes the most honest way to protect a block:

\`\`\`js
// Keep a focus block free: fail loudly if someone books over it.
const FOCUS_HOURS = [9, 10];

export function isProtected(slot) {
  return FOCUS_HOURS.includes(new Date(slot).getHours());
}
\`\`\`

It will not save you on its own. But a rule written down is easier to defend than a mood.

## The honest summary

You cannot manufacture silence in a shared space. You can manufacture expectations, and expectations are most of the battle. Block the time, say the words, keep the promises. The loud office stays loud; your day gets a spine.`,
  },
  {
    title: 'Small Teams Ship Big Things',
    slug: 'small-teams-ship-big-things',
    category: 'Startup',
    tags: ['startup', 'teams', 'product'],
    author: 'Maya Ferreira',
    excerpt: 'A study of six companies that did a lot with a handful of people — and the unglamorous habits they shared.',
    cover: '/assets/seed/covers/small-teams-ship-big.webp',
    daysAgo: 13,
    views: 2470,
    content: `There is a myth that important work requires a large organisation. The evidence suggests otherwise: it requires a small number of people with unusually clear priorities.

Over six months we interviewed six teams of six people or fewer. Between them they had shipped a payments platform, a regional airline app, a hardware product and a small newspaper. The details differed. The habits did not.

## They shared one metric

Not a dashboard. One number, visible to everyone, that answered the question *are we winning this month?* Everything else was context.

> When a team cannot name its single most important number, it will invent twelve.

## They made decisions in hours, not weeks

Small teams are not faster because they type faster. They are faster because there are fewer people to consult and a shared understanding of who decides.

- One owner per decision, named in the doc.
- A default: if nobody objects in 48 hours, it ships.
- Reversibility as a first-class concept: cheap decisions are made cheaply.

## They said no out loud

Every team described a version of the same ritual: a visible list of things they were **not** doing this quarter, reviewed in public. Saying no to features is easy in theory. Writing it down, with names attached, is how it becomes real.

## They kept meetings small and short

Stand-ups of fifteen minutes. Weekly planning in thirty. No all-hands for a team that fits in a van. The communication overhead of a small team can still eat the whole team if you let it.

## What breaks

Small teams break on succession and documentation. The same intimacy that makes them fast makes them fragile when someone leaves. The better teams treated writing as a form of redundancy: not bureaucracy, insurance.

### A checklist for staying small on purpose

1. Hire when a role is impossible, not when it is merely tiring.
2. Document the decision, not the meeting.
3. Keep the surface area of the product embarrassingly small.
4. Review the "not doing" list every month.
5. Protect one day a week from all coordination.

Small is not automatically good. But it is a constraint that forces clarity, and clarity, given enough time, looks a lot like momentum.`,
  },
  {
    title: 'The Case for Slow Mornings',
    slug: 'the-case-for-slow-mornings',
    category: 'Health',
    tags: ['habits', 'sleep', 'attention'],
    author: 'Priya Raman',
    excerpt: 'Four olympic athletes, three neuroscientists and one very ordinary baker on the first ninety minutes of the day.',
    cover: '/assets/seed/covers/case-for-slow-mornings.webp',
    daysAgo: 17,
    views: 5104,
    content: `Somewhere between the 5am club and the doomscroll lies a third option: a morning that starts at a human speed.

I spent three weeks asking people whose days begin early and well what they actually do. The answers were startlingly low-tech.

## Nobody was optimising

The athletes stretched. The neuroscientist read fiction. The baker, unsurprisingly, baked. What they shared was not a protocol but a lack of urgency: no inbox, no metrics, no audience for the first hour.

> The first hour of the day is the only hour nobody else has opinions about yet. Give it away slowly.

## Why it works

Sleep inertia — the foggy period after waking — is real, and it lasts longer than most of us admit. Bright light, water and gentle movement help. Racing into a meeting does not.

Caffeine taken immediately on waking blunts the natural cortisol curve; delaying it by 60–90 minutes tends to produce a steadier morning. This is a subtle effect, not a law. But it is free.

## Their habits, in order of appearance

1. **Light before screens.** Ten minutes outside, or a bright window.
2. **Water before coffee.** Unromantic, effective.
3. **Movement that is not training.** A walk, a stretch, stairs.
4. **One page of input.** A book, a notebook — not a feed.
5. **A single intention.** What would make today count?

## The objection

"But my mornings are chaos." Mine too. The point is not a perfect routine. It is to reclaim one narrow slice — even twelve minutes — before the day starts making demands.

![A quiet morning desk with a notebook and coffee](/assets/seed/cards/case-for-slow-mornings.webp "Twelve minutes is enough to count")

You do not need a cold plunge or a productivity system. You need to not hand over the first hour to somebody else's priorities. Start there. The rest is decoration.`,
  },
  {
    title: 'How to Learn in Public Without Burning Out',
    slug: 'how-to-learn-in-public',
    category: 'Education',
    tags: ['learning', 'writing', 'career'],
    author: 'Maya Ferreira',
    excerpt: 'Sharing the messy middle is powerful — and exhausting if you do it wrong. A calmer playbook for learning out loud.',
    cover: '/assets/seed/covers/learning-in-public.webp',
    daysAgo: 22,
    views: 1934,
    content: `The advice to "learn in public" is good and incomplete. It leaves out the part where you have to keep doing it on the days you feel like a fraud.

## Publish the process, not the performance

There is a difference between documenting what you are learning and staging a confident version of it. The first compounds. The second collapses the moment you have a bad week.

> You do not need to be right. You need to be specific.

Specific means: this week I tried X, I expected Y, I got Z, here is what I will do next. That structure is repeatable and honest.

## A sustainable rhythm

- **Weekly, small.** One note, one problem, one thing you now understand.
- **Long-form when it is ready.** A proper essay every six to eight weeks, not every Saturday.
- **Ship the draft.** Half-formed is not the same as careless.

## Protect the learning

The trap of public learning is that the publishing becomes the work. Keep a private notebook, and let the public version be a summary of what was already true.

### Three prompts that never fail

1. What did I believe last month that I no longer believe?
2. What would I tell someone two steps behind me?
3. What is the smallest example that makes this idea obvious?

## On the inevitable critic

Someone will point out that this has been said before. They are right, and they are missing the point: you are not trying to be first, you are trying to be useful. The best place to start is where you are, with the words you have.

Learning in public is not a performance. It is a paper trail of becoming. Keep the trail honest and the stakes low, and it will outlast you.`,
  },
  {
    title: 'What Endurance Athletes Understand About Thinking',
    slug: 'what-endurance-athletes-understand-about-thinking',
    category: 'Sport',
    tags: ['endurance', 'running', 'focus'],
    author: 'Priya Raman',
    excerpt: 'Marathoners don’t outrun doubt. They build a relationship with it. Four lessons from the back half of the race.',
    cover: '/assets/seed/covers/endurance-athletes-think.webp',
    daysAgo: 26,
    views: 2870,
    content: `At kilometre twenty-eight of my first marathon, I realised the race was not a physical event with a mental component. It was the other way around.

## The wall is a story

Nobody hits a wall of material. They hit a wall of narrative: *I have already done enough to justify stopping*. Runners who finish are not missing that voice. They have practiced answering it.

> The trick is not silence. It is having something to say back.

## Four habits worth stealing

1. **Break the distance down.** Not "20 kilometres left" but "the next tree, then the next".
2. **Have a mantra ready.** Mine is unprintable. Yours can be gentler.
3. **Practice discomfort on purpose.** Longer runs, no music sometimes, cold mornings. Familiarity is a skill.
4. **Recover as deliberately as you train.** Adaptation happens in the rest.

## The applicability

I am not going to tell you that hiring is like a marathon. But the mental texture of a hard project is strikingly similar: a long middle where the evidence is not yet in, and a decision to continue made hundreds of times.

Endurance is a practice in keeping a promise to yourself when the conditions are dull. That is trainable. That is the whole sport.`,
  },
  {
    title: 'Designing a Life You Do Not Need to Escape',
    slug: 'designing-a-life-you-do-not-need-to-escape',
    category: 'Culture',
    tags: ['creativity', 'career', 'money'],
    author: 'Ines Duarte',
    excerpt: 'On the difference between a vacation and a life — and why the design part is more arithmetic than aesthetics.',
    cover: '/assets/seed/covers/designing-a-life.webp',
    daysAgo: 31,
    views: 3260,
    content: `The phrase "design your life" tends to conjure mood boards. In practice, it is mostly arithmetic: the hours, the money, the people. What do you want your ordinary Tuesday to feel like?

## Start with a Tuesday

Not the highlight reel. A regular Tuesday: waking up, the commute you do have, the work you would do at 2pm, the evening. If that Tuesday is not acceptable, the holidays will not fix it.

## Three honest columns

Write three lists, in this order:

1. **Non-negotiables.** Sleep, family, health. The things that make the rest possible.
2. **Investments.** Work you would do even if it paid slowly, people you want to become like.
3. **Leaks.** The obligations you inherited and have never renegotiated.

Most people optimise column three and never touch column two.

> A life you do not need to escape is not a small life. It is a well-edited one.

## On money

Money buys optionality, not freedom by itself. The useful question is not "how much do I need" but "which trade am I unwilling to make any more". Answer that and the number gets smaller.

## The unglamorous middle

Designing a life is not a one-time decision; it is a seasonal review. Every quarter, ask: what is currently true about my week that I did not choose? Then choose one thing to change.

That is it. No manifesto. Just a slightly better Tuesday, repeated until it looks like a life.`,
  },
  {
    title: 'The Economics of Attention',
    slug: 'the-economics-of-attention',
    category: 'Business',
    tags: ['attention', 'money', 'product'],
    author: 'Avery Cole',
    excerpt: 'If attention is the currency, who is really paying? A practical reading of the business models under our feeds.',
    cover: '/assets/seed/covers/economics-of-attention.webp',
    daysAgo: 37,
    views: 1780,
    content: `Every business model answers one question: who pays, and for what? When the user is not paying, the answer is usually that the user's attention is the product being sold.

## Three models, three incentives

| Model | Who pays | Incentive |
| --- | --- | --- |
| Subscription | The reader | Keep the reader satisfied |
| Advertising | The advertiser | Keep the reader engaged |
| Commerce | The buyer | Convert intent into purchase |

None of these is evil. But they explain different behaviour. A subscription business can afford a quiet week. An advertising business generally cannot.

> Engagement is not the same as value. The most valuable hour of your day is often the least engaging one.

## What it means for a small publication

We chose subscriptions and memberships early, not out of purity but because it aligned our incentive with the person reading. The cost is slower growth. The benefit is that we can publish something difficult and slow without watching the open rate fall.

## A practical test for readers

When you meet a new feed, a new product, a new "platform", ask:

1. Who pays here?
2. What do they want from me?
3. What would this look like if it wanted what I want?

That is the whole field of media economics, honestly. The rest is monetisation footnotes.`,
  },
  {
    title: 'Notes From a Mountain Town in November',
    slug: 'notes-from-a-mountain-town-in-november',
    category: 'Travel',
    tags: ['slow travel', 'travel', 'writing'],
    author: 'Ines Duarte',
    excerpt: 'Off-season is the season locals actually live in. A dispatch from a valley where the lifts are closed and the town exhales.',
    cover: '/assets/seed/covers/notes-mountain-town.webp',
    daysAgo: 44,
    views: 1420,
    content: `The cable car is closed. The rental shops are shuttered. The only people on the main street are a woman walking two dogs and a man painting a sign that has not needed painting since 1998.

Off-season is the honest version of a place.

## What closes and what stays

Everything optimised for visitors closes. Everything optimised for living stays: the school, the bakery, the pharmacy, the small library with three computers. You learn what a town is made of by what it keeps open when nobody is watching.

## The pace

Mornings are for errands, which take longer and involve more conversation than errands at home. Afternoons are for walking. There is a specific silence at four o'clock, when the light leaves the valley, that I have not found anywhere else.

> Travel in the shoulder season and you will spend less and see more, as long as "more" includes watching someone paint a sign.

## Practical notes

- Bring warmer clothes than the forecast suggests; valleys are their own climate.
- Ask at the bakery, not at the tourist office, for what is open.
- Expect places to close early, and plan dinner before seven.

I left with a notebook of small things and no photographs of a mountain. The mountain was there the whole time. I just stopped needing it to pose.`,
  },
  {
    title: 'Products People Keep',
    slug: 'products-people-keep',
    category: 'Startup',
    tags: ['product', 'design', 'startup'],
    author: 'Tobias Lindqvist',
    excerpt: 'Retention is not a growth metric. It is evidence that something in the product became part of someone’s day.',
    cover: '/assets/seed/covers/products-people-keep.webp',
    daysAgo: 52,
    views: 2210,
    content: `We studied twelve products that people still use after five years. Most were unglamorous. All of them had one thing in common: they made a specific promise and kept it, quietly, for a long time.

## The promise test

Write your product's promise in one sentence, in plain language. If you cannot, users cannot either.

- Good: *your invoices go out on time and you know when they were read.*
- Bad: *reimagine how teams collaborate.*

## The three reasons people stay

1. **Data gravity.** Their history lives here.
2. **Habit gravity.** It is where their hands already go.
3. **Trust.** It does exactly what it says, including when it fails.

New features can win a small burst of attention. Only these three keep anyone.

> The opposite of churn is not delight. It is reliability.

## Boring is a strategy

The most durable products I know ship slower than their competitors and break less. They treat every new surface as a permanent obligation. They say no to features that would add one more place for the promise to leak.

### A short retention audit

- Ask ten long-term users why they still use it. Write down their exact words.
- Find the one workflow that shows up in nine of ten answers.
- Make that workflow 20% faster this quarter. Nothing else.

That is not growth hacking. It is the only growth that stays.`,
  },
  {
    title: 'A Useful Side Project, Start to Finish',
    slug: 'a-useful-side-project-start-to-finish',
    category: 'Tech',
    tags: ['product', 'career', 'creativity'],
    author: 'Tobias Lindqvist',
    excerpt: 'A walkthrough of building a small tool that solves your own problem in four weekends — and knowing when to stop.',
    cover: '/assets/seed/covers/useful-side-project.webp',
    daysAgo: 61,
    views: 1655,
    content: `The best side projects are not startups. They are small tools that remove a specific friction from your own week.

Mine was a folder watcher that renames exported files and logs where they came from. Deeply uninteresting. Used every day for three years.

## Weekend one: define the friction

Write the friction as a sentence with a number in it. "I waste 4 minutes a day renaming exports" is a project. "I want to learn Rust" is a hobby, which is also fine — just do not confuse them.

## Weekend two: the smallest ugly version

No auth. No settings page. No database. A script in a folder, and a cron job. Ugly is a feature: it keeps you honest about whether the friction is real.

\`\`\`bash
#!/usr/bin/env bash
set -euo pipefail

for file in "$HOME/exports/"*.csv; do
  [ -e "$file" ] || continue
  stamp="$(basename "$file" .csv | cut -d- -f1)"
  mv "$file" "$HOME/exports/archive/\${stamp}.csv"
done
\`\`\`

## Weekend three: make it survive you forgetting

If it depends on your memory, it is not a tool. Add a log, a failure notification, and a short README with the one command that fixes it.

## Weekend four: decide to stop

The fourth weekend is the most important. Either the friction is gone, and you stop, or it is not, and you stop anyway and rethink. Side projects die of scope, not neglect.

> A finished small thing beats an ambitious unfinished one. Every time, and twice on Sundays.

## When it becomes more

If someone else asks to use it, that is data. But wait for three someone elses before you build user accounts. Most projects should stay yours.`,
  },
  {
    title: 'Everything Is Wrong With Your Focus',
    slug: 'everything-wrong-with-your-focus',
    category: 'Culture',
    tags: ['attention', 'focus', 'productivity'],
    author: 'Avery Cole',
    excerpt: 'A contrarian read of the attention industry: maybe the problem is not your discipline, but the shape of your week.',
    cover: '/assets/seed/covers/everything-wrong-focus.webp',
    daysAgo: 74,
    views: 1390,
    content: `There is a genre of writing about focus that begins with your personal failing and ends with a system. I want to begin somewhere else: the structure.

## The shape of a week

If your week has no long blocks, no protected mornings, and no one thing that must be finished, no app will save you. Attention is not a reservoir of willpower. It is a response to the shape of the container.

> You cannot meditate your way out of a calendar built by someone else.

## Four structural fixes

1. **Fewer commitments.** Not better prioritisation — fewer lines on the page.
2. **Longer blocks.** A 90-minute block beats three 30-minute ones, always.
3. **One visible finish line per week.** The thing you will point to on Friday.
4. **A boundary someone else knows about.** Unowned boundaries are wishes.

## On systems

Systems are useful when they reduce decisions. They are harmful when they become the work. If your productivity app has a weekly review of your weekly review, you have built a second job.

## A modest proposal

Pick one afternoon this week. Cancel it. Do the thing you keep moving. Notice that the world does not end, and that the thing takes less time than the anxiety about it.

That is not a system. That is evidence. Evidence is what actually changes behaviour.`,
  },
  {
    title: 'Why We Walk',
    slug: 'why-we-walk',
    category: 'Sport',
    tags: ['habits', 'endurance', 'creativity'],
    author: 'Priya Raman',
    excerpt: 'Walking is the most underrated training, the oldest thinking tool, and the only exercise nobody has managed to gamify into misery.',
    cover: '/assets/seed/covers/why-we-walk.webp',
    daysAgo: 88,
    views: 1160,
    content: `Before it was a step count, walking was how we thought. Philosophers did it in courtyards, writers in loops around the block, and every grandmother on earth has done it as a form of both exercise and conversation.

## The research, briefly

Walking increases cerebral blood flow and reliably improves divergent thinking — the kind that generates options rather than checking them. The effect does not require a forest. A corridor will do.

> You do not need a better idea. You need a longer walk before deciding you have no ideas.

## The practice

- **After lunch.** Ten minutes, outside, no phone.
- **Before writing.** Fifteen minutes with a question in your head, no music.
- **After conflict.** Long enough that you are breathing normally before you reply.

## On step counts

Ten thousand steps is a marketing number. The health benefits of walking start well below it and continue above it. The best number is the one you will do tomorrow without a reward.

## The oldest tool

Walking is portable, free, and impossible to optimise into misery. You cannot doomscroll while walking at a decent pace, though many try. It is the last unclaimed hour.

Take it.`,
  },
  {
    title: 'Off-Season: The Case for Travelling When Nobody Else Does',
    slug: 'off-season',
    category: 'Travel',
    tags: ['travel', 'slow travel', 'money'],
    author: 'Ines Duarte',
    excerpt: 'Cheaper, quieter, and closer to how a place actually works. A practical argument for booking the shoulder months.',
    cover: '/assets/seed/covers/off-season.webp',
    daysAgo: 96,
    views: 980,
    content: `Peak season is a performance of a place. Off-season is the rehearsal, where you can see the mechanics.

## The economics

Prices fall by a third to a half. Flights are cheaper. Restaurants that survive have an incentive to be good rather than merely convenient.

## The weather question

Shoulder months are unpredictable, which is either a dealbreaker or the point. Pack layers, keep a plan B in the same town, and stop treating rain as a failure of the trip.

## What locals say

Every person I asked in three different towns said some version of: *come back in May, or October, when we can actually talk to you.*

> In July you are traffic. In November you are a guest.

## How to do it well

1. Book flexible accommodation for the first two nights only.
2. Check what closes for the season, and plan around it.
3. Expect early dinners and limited transport.
4. Bring a book. The pace is the product.

Off-season travel will not give you the photograph. It will give you the town. For most of us, that is the better trade.`,
  },
  {
    title: 'Money, Quietly',
    slug: 'money-quietly',
    category: 'Business',
    tags: ['money', 'habits', 'career'],
    author: 'Avery Cole',
    excerpt: 'Personal finance has an attention problem. A low-drama approach to money for people who would rather be doing something else.',
    cover: '/assets/seed/covers/money-quietly.webp',
    daysAgo: 110,
    views: 2035,
    content: `Most personal finance content is engineered to make you feel behind. Quiet money management is the opposite: a small set of numbers, looked at rarely, that buys you freedom from the topic.

## The numbers that matter

1. **Your fixed costs.** Rent, utilities, debt, subscriptions.
2. **Your buffer.** Months of fixed costs you can cover in cash.
3. **Your savings rate.** The percentage you do not spend.
4. **Your one big goal.** The number attached to a date.

Everything else is commentary.

> Financial peace is not a large number. It is a low number of surprises.

## A quiet system

- Automate the transfer on payday, not the intention.
- Review the subscriptions twice a year, not monthly.
- Choose the boring index fund and stop reading the forum.
- Rebalance annually. Ignore the rest.

## On earning more

Income growth is usually more powerful than frugality, and it is also the part people skip because it is harder. Two levers: get better at a valuable thing, and make sure the people paying know.

## The point

Money is not a hobby for everyone. It is infrastructure. Build it simple, keep it boring, and spend your attention on the things that will not show up in a spreadsheet at the end.`,
  },
];

export interface SeedPage {
  title: string;
  slug: string;
  excerpt: string;
  template?: string;
  content: string;
}

export const SEED_PAGES: SeedPage[] = [
  {
    title: 'About Azure Gravy',
    slug: 'about',
    excerpt: 'An independent journal about good work, slow travel and the creative life — served warm, twice a week.',
    content: `## A small publication, on purpose

Azure Gravy started as a shared document between four friends who were tired of two kinds of writing: the breathless kind and the empty kind. We wanted something in between — careful, useful, and occasionally funny.

We publish two or three pieces a week, plus a letter on Sundays. There are no sponsored posts inside the essays, and no AI-generated filler disguised as reporting. If we do not have something to say, we do not publish.

### What we write about

- **Work and craft** — how good things actually get made, including the boring parts.
- **Travel and culture** — the places between postcards, and the habits we bring home.
- **Health and attention** — sleep, endurance, focus and the long game.

> We are less interested in being productive than in being deliberate.

## Who we are

A very small team of writers and editors across five cities. You can find each of us on the author pages, along with everything we have published here.

## How it is funded

Mostly by members and the Sunday letter, plus a handful of workshops each year. This means our incentives are boring in the way we like: keep readers happy, avoid publishing things that waste their time.

### Get in touch

Story tips, corrections and disagreements are all welcome. Write to us at [hello@gravy.local](mailto:hello@gravy.local) or use the [contact page](/contact).`,
  },
  {
    title: 'Contact',
    slug: 'contact',
    excerpt: 'Story tips, corrections, partnerships or just a note about something you read — this reaches a real person.',
    template: 'contact',
    content: `We read everything, though we cannot always reply straight away. For story pitches, one paragraph plus why it belongs here is enough.`,
  },
  {
    title: 'Privacy',
    slug: 'privacy',
    excerpt: 'What we collect, what we do not, and how to make us forget you.',
    content: `## The short version

We collect the minimum needed to run a publication: your email if you subscribe, your name and message if you write to us, and basic analytics about which stories are read.

## What we collect

- **Newsletter:** your email address, and optionally your name. Stored in our own database.
- **Comments:** the name and optional email you provide. Email addresses are never published.
- **Server logs:** IP address and user agent for security and rate limiting. Retained for 30 days.
- **Cookies:** one session cookie for signing in and remembering your theme preference.

## What we do not do

We do not sell data. We do not run third-party advertising trackers inside articles. We do not use your email for anything beyond the letter you signed up for.

## Your rights

Write to [hello@gravy.local](mailto:hello@gravy.local) to request an export or deletion of your data. We will confirm within seven days.

## Changes

If this policy changes materially, we will note it in the newsletter. That is the only announcement channel we have, which is also the honest one.`,
  },
  {
    title: 'Terms',
    slug: 'terms',
    excerpt: 'The reasonable rules for reading, quoting and commenting here.',
    content: `## Reading

Everything on this site is free to read. You may quote up to 200 words with attribution and a link. For longer excerpts or republishing, write to us first.

## Comments

Comments are moderated. We remove spam, harassment, and anything that makes the conversation worse. Editing for clarity is occasionally done; meaning is never changed. You retain copyright in your comments and grant us a licence to display them.

## Subscriptions

The Sunday letter is free. Paid memberships, where available, renew annually and can be cancelled at any time from the link in every letter.

## Liability

We write in good faith and make mistakes. Nothing here is professional advice — financial, medical or legal. If you act on something you read, that is your decision, and we would love to hear how it went.

## Contact

Questions about these terms: [hello@gravy.local](mailto:hello@gravy.local).`,
  },
];

export interface SeedComment {
  postSlug: string;
  author: string;
  email: string;
  content: string;
  status: 'approved' | 'pending' | 'spam';
  daysAgo: number;
  replyTo?: string;
}

export const SEED_COMMENTS: SeedComment[] = [
  { postSlug: 'quiet-power-of-doing-one-thing-at-a-time', author: 'Daniel Osei', email: 'daniel@example.com', content: 'The “one card, one outcome” idea landed for me. I have been keeping three priorities and finishing none of them.', status: 'approved', daysAgo: 1 },
  { postSlug: 'quiet-power-of-doing-one-thing-at-a-time', author: 'Avery Cole', email: 'admin@azuregravy.local', content: 'Glad it helped, Daniel. The card trick works because it is physical — you cannot scroll past it.', status: 'approved', daysAgo: 1, replyTo: 'Daniel Osei' },
  { postSlug: 'quiet-power-of-doing-one-thing-at-a-time', author: 'Hannah Weiss', email: 'hannah@example.com', content: 'Curious how you handle a job where interruptions are genuinely part of the role? I work in support and “deep work” feels like a luxury.', status: 'approved', daysAgo: 0 },
  { postSlug: 'what-travel-teaches-about-culture-and-life', author: 'Marco Rossi', email: 'marco@example.com', content: 'The laundrette story is perfect. The best travel memories are always admin.', status: 'approved', daysAgo: 3 },
  { postSlug: 'field-guide-to-deep-work', author: 'Sana Iqbal', email: 'sana@example.com', content: 'We adopted the three-block day after reading this and our stand-ups got shorter. Small sample size, but promising.', status: 'approved', daysAgo: 6 },
  { postSlug: 'the-case-for-slow-mornings', author: 'Leo Martins', email: 'leo@example.com', content: 'I delayed coffee by ninety minutes for a week. I am not a new man, but the mornings are noticeably less jagged.', status: 'approved', daysAgo: 12 },
  { postSlug: 'the-case-for-slow-mornings', author: 'Priya Raman', email: 'priya@azuregravy.local', content: 'That is exactly the right expectation, Leo. Less jagged is the goal.', status: 'approved', daysAgo: 11, replyTo: 'Leo Martins' },
  { postSlug: 'small-teams-ship-big-things', author: 'Guy who sells synergy', email: 'promo@spam.example', content: 'Great post! Check my profile for 10x growth secrets and a free funnel template.', status: 'spam', daysAgo: 8 },
  { postSlug: 'money-quietly', author: 'Elena Petrova', email: 'elena@example.com', content: 'The “low number of surprises” line is going on my wall. Would love a follow-up on freelancer cash flow.', status: 'pending', daysAgo: 2 },
  { postSlug: 'designing-a-life-you-do-not-need-to-escape', author: 'Tom Becker', email: 'tom@example.com', content: 'What if your Tuesday is fine but your Sunday is dreadful? Asking for a friend (me).', status: 'pending', daysAgo: 4 },
  { postSlug: 'why-we-walk', author: 'Ada Nwosu', email: 'ada@example.com', content: 'Walked to the shop without headphones after reading. Had an idea I had been chasing for a month.', status: 'approved', daysAgo: 20 },
  { postSlug: 'how-to-learn-in-public', author: 'Kenji Sato', email: 'kenji@example.com', content: 'The prompt “what would I tell someone two steps behind me” is going straight into my notebook.', status: 'approved', daysAgo: 18 },
];

export const SEED_SUBSCRIBERS = [
  ['elena@example.com', 'Elena Petrova'],
  ['daniel@example.com', 'Daniel Osei'],
  ['hannah@example.com', 'Hannah Weiss'],
  ['marco@example.com', 'Marco Rossi'],
  ['sana@example.com', 'Sana Iqbal'],
  ['leo@example.com', 'Leo Martins'],
  ['ada@example.com', 'Ada Nwosu'],
  ['kenji@example.com', 'Kenji Sato'],
  ['julia@example.com', 'Julia Nowak'],
  ['amir@example.com', 'Amir Haddad'],
  ['nora@example.com', 'Nora Lindberg'],
  ['sam@example.com', 'Sam Whitfield'],
];

export const SEED_MESSAGES = [
  {
    name: 'Clara Duval',
    email: 'clara@example.com',
    subject: 'Pitch: the four-day week, two years on',
    message:
      'Hi — I run a small design studio that moved to a four-day week in 2024. I have two years of data, including the failures, and would love to write it up for Azure Gravy. Happy to send an outline.',
    daysAgo: 1,
    isRead: false,
  },
  {
    name: 'Peter Lang',
    email: 'peter@example.com',
    subject: 'Correction on the endurance piece',
    message:
      'Small thing: the marathon wall section says 28km, but the study you are probably thinking of measures at 30–32km for most recreational runners. Otherwise a lovely read.',
    daysAgo: 3,
    isRead: true,
  },
];
