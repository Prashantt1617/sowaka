// Moving someone to geotagged punching. The punch method is a setting of the
// shift template (a template's `punchFormat`, else its policy's
// `correction.punchFormat`), not of the person, and the office radius is a
// setting of each office under Offices — so the action is "move them to a
// geotag template", and the card says so. Confirm goes through the same
// assignment the Bulk Assign page uses (the assign_shift executor), with Undo.
import { offices } from '../../config/db';
import { ShiftTemplate } from '../../models/shift.model';
import { getOrgShiftPolicy, mergeTemplatePolicy } from '../../services/shift.service';
import { defineTools, num, str, SuwiContext } from '../tools';
import { liveTemplates, prepareMove, templateNamed } from './shifts';
import { resolveTeam } from './team';

const GEOTAG = 'Geotag (powered by Sowaka)';

async function geotagTemplates(ctx: SuwiContext): Promise<ShiftTemplate[]> {
  const orgPolicy = await getOrgShiftPolicy(ctx.org);
  return (await liveTemplates(ctx)).filter((t) => t.active && mergeTemplatePolicy(orgPolicy, t).correction.punchFormat === GEOTAG);
}

defineTools(
  {
    name: 'prepare_move_to_geotag',
    area: 'attendance',
    acts: true,
    label: (i) => `Prepared: move ${Array.isArray(i.names) ? i.names.join(', ') : i.department ? `the ${i.department} department` : i.manager ? `${i.manager}'s reports` : 'people'} to geotag punching`,
    description: 'Prepare moving a person or team to geotagged (location-checked) punching. In Sowaka the punch method belongs to the shift template, so this moves them to a shift template whose punch format is Geotag; name the template if there are several. The card explains the office radius, what happens to off-site days, the pay effect and when it starts. Changes nothing until HR confirms. Pick people by userIds, names, department or manager.',
    input_schema: { type: 'object', properties: { userIds: { type: 'array', items: { type: 'string' } }, names: { type: 'array', items: { type: 'string' } }, department: { type: 'string' }, manager: { type: 'string' }, template: { type: 'string', description: 'A geotag shift template, if there is more than one' }, radiusMeters: { type: 'number', description: 'If HR asked for a radius; it cannot be set per person, the card says where it lives' } } },
    api: { method: 'POST', path: '/admin/shifts/x/assign' },
    async run(ctx, i) {
      const candidates = await geotagTemplates(ctx);
      if (!candidates.length) {
        return { data: { needs: [`a shift template whose punch format is "${GEOTAG}"`], message: `No shift template in this company uses ${GEOTAG} yet. Create one (prepare_create_shift_template with punchFormat "${GEOTAG}") or set a template's punch format on Shift Templates, then move people to it.` }, links: [{ label: 'Open shift templates', view: 'shifttypes' }] };
      }
      let tpl: ShiftTemplate | undefined;
      if (str(i.template)) {
        tpl = await templateNamed(ctx, str(i.template));
        if (!tpl) throw new Error(`No shift template called "${str(i.template)}"`);
        if (!candidates.some((c) => c._id!.equals(tpl!._id!))) throw new Error(`${tpl.name} does not use ${GEOTAG}; its punch format is a template setting on Shift Templates`);
      } else if (candidates.length === 1) tpl = candidates[0];
      else return { data: { needs: ['template'], options: candidates.map((t) => ({ name: t.name, start: t.policy?.startTime, end: t.policy?.endTime, people: (t.assignedUserIds ?? []).length })), message: 'Several templates use geotag punching; say which one.' } };

      const { people, how } = await resolveTeam(ctx, i);
      const sites = await offices().find({ org: ctx.org, active: true }).toArray();
      const policy = mergeTemplatePolicy(await getOrgShiftPolicy(ctx.org), tpl);
      const ool = policy.correction.outsideLocation;
      const siteWords = sites.length ? sites.map((o) => `${o.name}${o.city ? ` (${o.city})` : ''} within ${o.radiusMeters} m`).join('; ') : 'no office has been set up under Offices yet, so every punch would be out of location';
      const askedRadius = num(i.radiusMeters, 0, 0, 100_000);
      const lines = [
        { text: `Punches need a phone location inside an office radius: ${siteWords}.`, why: 'Geotag punching matches each punch to the nearest office. The radius belongs to the office (Offices page) and applies to everyone who punches there; it cannot be set per person.', ...(sites.length ? {} : { tone: 'warn' as const }) },
        ...(askedRadius ? [{ text: `A ${askedRadius} m radius cannot be set for one person; change the office's radius under Offices, which changes it for everyone punching there.`, tone: 'warn' as const }] : []),
        {
          text: ool.outcome === 'request'
            ? `A punch from outside every office sends an out-of-location request to their manager (reasons offered: ${ool.reasons.join(', ')}); the day stands as absent until it is approved.`
            : `A punch from outside every office marks the day present with a remark (reasons offered: ${ool.reasons.join(', ')}); HR sees it under OOL check-ins.`,
          why: `This is the template's out-of-location rule (${tpl.name} › Attendance correction › Out of location).`,
        },
        { text: `Days without a punch inside the radius can become absent or a missed punch (punch-in missing counts as ${policy.missingPunchIn}, punch-out missing ${policy.missingPunchOut}), so loss of pay can rise.`, why: 'Payroll pays by the calendar: each absence costs a paid day and each half day half a day, on top of any rules in their paid-days template.', tone: 'warn' as const },
      ];
      return prepareMove(ctx, tpl, people.slice(0, 500), { title: `Move ${people.length === 1 ? people[0].name : `${people.length} people`} to geotag punching (${tpl.name})`, summaryPrefix: `${people.length > 1 ? `${how[0].toUpperCase()}${how.slice(1)}: ` : ''}Geotag punching is a template setting, so this moves them to the ${tpl.name} template. `, extraLines: lines });
    },
  },
);
