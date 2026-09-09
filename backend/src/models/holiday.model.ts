/** How the day is observed. Restricted and optional days are still non-working
 *  for whoever takes them, so all three are treated alike by leave counting. */
export type HolidayType = 'Public' | 'Restricted' | 'Optional';

export interface Holiday {
  org: string;
  /** Work location the holiday applies to. `*` means every location. */
  state: string;
  type?: HolidayType;
  date: Date;
  name: string;
  createdByUserId?: string;
  createdAt?: number;
  updatedAt?: Date;
}
