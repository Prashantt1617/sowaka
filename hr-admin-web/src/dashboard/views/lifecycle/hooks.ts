// Small hooks the lifecycle pages share.
import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { useBrand } from '../../brand';
import { getCompanySettings, getOffices } from '../../../services/hrms';

/** The company's name as letters and emails carry it. */
export function useCompanyName(): string {
  const brand = useBrand();
  const { user } = useStore();
  return brand.name ?? user?.company ?? 'the company';
}

/** Department, designation and location choices for the offer form. */
export function useOfferChoices() {
  const [designations, setDesignations] = useState<string[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  useEffect(() => {
    getCompanySettings().then((s) => { setDesignations(s.designations ?? []); setDepartments(s.departments ?? []); }).catch(() => undefined);
    getOffices().then((o) => setLocations(o.map((x) => x.name))).catch(() => undefined);
  }, []);
  return { designations, departments, locations };
}

