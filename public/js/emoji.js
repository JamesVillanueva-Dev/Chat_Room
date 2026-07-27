/** Emoji offered by the reaction picker, grouped for browsing and searchable by keyword. */
export const EMOJI_GROUPS = [
  {
    name: 'Reactions',
    emoji: [
      ['👍', 'thumbs up yes agree plus'],
      ['👎', 'thumbs down no disagree minus'],
      ['❤️', 'heart love'],
      ['🔥', 'fire hot lit'],
      ['🎉', 'party tada celebrate'],
      ['👏', 'clap applause'],
      ['🙏', 'thanks please pray'],
      ['✅', 'check done tick yes'],
      ['❌', 'cross no wrong'],
      ['👀', 'eyes looking watching'],
      ['🚀', 'rocket ship launch'],
      ['💯', 'hundred perfect'],
    ],
  },
  {
    name: 'Smileys',
    emoji: [
      ['😀', 'grin happy smile'],
      ['😄', 'smile happy'],
      ['😅', 'sweat laugh nervous'],
      ['😂', 'joy laugh crying tears'],
      ['🙂', 'slight smile'],
      ['😉', 'wink'],
      ['😊', 'blush smile'],
      ['😍', 'heart eyes love'],
      ['😎', 'cool sunglasses'],
      ['🤔', 'thinking hmm'],
      ['😐', 'neutral meh'],
      ['🙃', 'upside down'],
      ['😴', 'sleep tired zzz'],
      ['😭', 'sob crying sad'],
      ['😡', 'angry mad rage'],
      ['🤯', 'mind blown exploding head'],
      ['🥳', 'partying celebrate'],
      ['😬', 'grimace awkward'],
      ['🤐', 'zipper quiet'],
      ['🫠', 'melting'],
    ],
  },
  {
    name: 'People',
    emoji: [
      ['👋', 'wave hello hi'],
      ['🤝', 'handshake deal'],
      ['💪', 'muscle strong'],
      ['🧠', 'brain smart'],
      ['🫶', 'heart hands'],
      ['🤷', 'shrug dunno'],
      ['🙌', 'raised hands praise'],
      ['🫡', 'salute yes sir'],
      ['👉', 'point right'],
      ['✍️', 'writing note'],
    ],
  },
  {
    name: 'Work',
    emoji: [
      ['💻', 'laptop computer code'],
      ['🐛', 'bug defect'],
      ['🔧', 'wrench fix tool'],
      ['📦', 'package box ship'],
      ['📌', 'pin pinned'],
      ['📝', 'memo notes'],
      ['📊', 'chart data stats'],
      ['⏰', 'alarm time clock'],
      ['🗓️', 'calendar date'],
      ['🔗', 'link url'],
      ['🔒', 'lock secure private'],
      ['⚡', 'zap fast lightning'],
      ['🧪', 'test experiment'],
      ['🚨', 'alert siren urgent'],
    ],
  },
  {
    name: 'Things',
    emoji: [
      ['☕', 'coffee break'],
      ['🍕', 'pizza food'],
      ['🍰', 'cake birthday'],
      ['🌮', 'taco food'],
      ['🎮', 'game controller play'],
      ['🎧', 'headphones music'],
      ['🏆', 'trophy win'],
      ['🪨', 'rock stone rps'],
      ['📄', 'paper page rps'],
      ['✂️', 'scissors cut rps'],
      ['🌧️', 'rain weather'],
      ['🌈', 'rainbow'],
      ['⭐', 'star favourite'],
      ['🌙', 'moon night'],
    ],
  },
];

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '👀', '🔥'];

const ALL = EMOJI_GROUPS.flatMap((group) =>
  group.emoji.map(([emoji, keywords]) => ({ emoji, keywords, group: group.name }))
);

export const searchEmoji = (query) => {
  const term = query.trim().toLowerCase();
  if (!term) return null;
  return ALL.filter((entry) => entry.keywords.includes(term) || entry.keywords.split(' ').some((word) => word.startsWith(term)));
};
