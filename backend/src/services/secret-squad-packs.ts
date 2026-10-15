/**
 * Secret Squad's word packs. Placeholder: the reviewed packs replace this file.
 * A pack is four themes written to mislead each other; words are ordered
 * trickiest first, and a round uses as many as its squad needs.
 */
export interface SquadTheme { name: string; words: string[]; traps: string }
export interface SquadPack { id: string; name: string; difficulty: 'easy' | 'medium' | 'hard'; themes: SquadTheme[] }

export const SQUAD_PACKS: SquadPack[] = [];
