const EMOTICON_MAP = [
  [/:-?\)\)/g, '😄'],
  [/:-?D/g, '😀'],
  [/:-?\)/g, '🙂'],
  [/:-?\(/g, '🙁'],
  [/;-?\)/g, '😉'],
  [/:-?P/gi, '😛'],
  [/:-?O/gi, '😮'],
  [/:'\(/g, '😢'],
  [/:-?\|/g, '😐'],
  [/<3/g, '❤️'],
  [/\bxd\b/gi, '😆'],
  [/:thumbsup:/g, '👍'],
  [/:thumbsdown:/g, '👎'],
  [/:heart:/g, '❤️'],
  [/:fire:/g, '🔥'],
  [/:smile:/g, '😄'],
  [/:laughing:/g, '😆'],
  [/:cry:/g, '😢'],
  [/:wink:/g, '😉'],
  [/:100:/g, '💯'],
  [/:tada:/g, '🎉'],
  [/:star:/g, '⭐']
];

export function convertEmoticons(text) {
  let result = text;
  EMOTICON_MAP.forEach(([pattern, emoji]) => {
    result = result.replace(pattern, emoji);
  });
  return result;
}

export const EMOJI_PICKER_LIST = [
  '😀', '😃', '😄', '😁', '😆', '😅', '🙂', '😉', '😊', '😍',
  '😘', '😜', '🤔', '😐', '😑', '😮', '😢', '😭', '😡', '🥳',
  '👍', '👎', '👏', '🙌', '🤝', '✌️', '🤞', '👋', '💪', '🙏',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🔥', '⭐', '✨', '🎉',
  '📦', '📷', '🎮', '🃏', '🧱', '🎬', '📚', '💰', '🏆', '✅'
];
