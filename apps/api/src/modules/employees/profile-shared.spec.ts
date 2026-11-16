import {
  certificationSchema,
  durationLabel,
  educationSchema,
  employeeSchema,
  employeeUpdateSchema,
  experienceSchema,
  formatPhoneDisplay,
  isSafeHttpUrl,
  parsePhone,
  phone,
  phoneProblem,
  recordBatchSchema,
  referenceSchema,
  selfProfileUpdateSchema,
  socialLinksSchema,
  toInternationalPhone,
  wfhRequestSchema,
  WORKFLOWS,
} from '@hrms/shared';

describe('phone numbers with country codes', () => {
  it('defaults to Pakistan and reads local numbers as +92', () => {
    expect(parsePhone('').country.iso).toBe('PK');
    expect(parsePhone('0300 1234567')).toEqual({ country: expect.objectContaining({ iso: 'PK' }), national: '3001234567' });
    expect(toInternationalPhone('0300 1234567')).toBe('+92 3001234567');
    expect(toInternationalPhone('042 1234567')).toBe('+92 421234567');
  });

  it('normalises international input to "+<code> <number>"', () => {
    expect(toInternationalPhone('+92 300 123 4567')).toBe('+92 3001234567');
    expect(toInternationalPhone('+44 7911 123456')).toBe('+44 7911123456');
    expect(toInternationalPhone('+971 50 123 4567')).toBe('+971 501234567');
    expect(toInternationalPhone('')).toBe('');
  });

  it('keeps unknown country codes instead of guessing Pakistan', () => {
    expect(toInternationalPhone('+999 12345678')).toBe('+99912345678');
    expect(formatPhoneDisplay('+999 12345678')).toBe('+999 12345678');
  });

  it('prefers the chosen country when codes are shared (+1 US / Canada)', () => {
    expect(parsePhone('+1 4165551234', 'CA').country.iso).toBe('CA');
    expect(parsePhone('+1 4155551234').country.dial).toBe('1');
  });

  it('validates the length for the selected country', () => {
    expect(phoneProblem('+92 3001234567')).toBeNull();
    expect(phoneProblem('+92 30012')).toMatch(/Pakistan number has 9–10 digits/);
    expect(phoneProblem('+44 79')).toMatch(/United Kingdom/);
    expect(phoneProblem('+971 501234567')).toBeNull();
    expect(phoneProblem('+92')).toMatch(/after the country code/);
  });

  it('rejects letters, stray plus signs and bad local numbers', () => {
    expect(phoneProblem('0300-ABC')).toMatch(/digits only/);
    expect(phoneProblem('92+300')).toMatch(/digits only/);
    expect(phoneProblem('300 1234567')).toMatch(/Start with 0/);
    expect(phoneProblem('0300 12')).toMatch(/too short/);
    expect(phoneProblem('0300 123456789')).toMatch(/too long/);
    expect(phoneProblem('')).toBeNull();
  });

  it('formats for display', () => {
    expect(formatPhoneDisplay('+92 3001234567')).toBe('+92 300 1234567');
    expect(formatPhoneDisplay('0300 1234567')).toBe('+92 300 1234567');
    expect(formatPhoneDisplay(null)).toBe('');
  });

  it('the shared phone schema validates and stores the international form', () => {
    expect(phone.parse('0321 1112223')).toBe('+92 3211112223');
    expect(phone.safeParse('+92 1').success).toBe(false);
    expect(phone.safeParse('').success).toBe(false);
  });
});

describe('safe links', () => {
  it('accepts http(s) only', () => {
    expect(isSafeHttpUrl('https://linkedin.com/in/x')).toBe(true);
    expect(isSafeHttpUrl('http://example.com')).toBe(true);
    for (const bad of ['javascript:alert(1)', 'data:text/html,<b>', 'ftp://x.com', 'https://user:pw@x.com', 'not a url', '', null]) {
      expect(isSafeHttpUrl(bad as string)).toBe(false);
    }
  });

  it('social links add https://, drop empties and refuse unsafe schemes', () => {
    const ok = socialLinksSchema.parse({ linkedin: 'linkedin.com/in/esha', x: '', custom: [{ label: 'GitHub', url: 'github.com/esha' }] });
    expect(ok).toEqual({ linkedin: 'https://linkedin.com/in/esha', x: undefined, instagram: undefined, facebook: undefined, website: undefined, custom: [{ label: 'GitHub', url: 'https://github.com/esha' }] });
    expect(socialLinksSchema.safeParse({ x: 'javascript:alert(1)' }).success).toBe(false);
    expect(socialLinksSchema.safeParse({ custom: [{ label: 'Empty', url: '' }] }).success).toBe(false);
    expect(socialLinksSchema.safeParse({ custom: Array.from({ length: 6 }, (_, i) => ({ label: `L${i}`, url: 'https://a.com' })) }).success).toBe(false);
  });
});

describe('duration of previous experience', () => {
  it('counts whole years and months', () => {
    expect(durationLabel('2019-01-01', '2021-06-30')).toBe('2 yrs 5 mos');
    expect(durationLabel('2020-01-15', '2021-01-15')).toBe('1 yr');
    expect(durationLabel('2020-01-15', '2020-03-15')).toBe('2 mos');
    expect(durationLabel('2020-01-15', '2020-01-30')).toBe('Less than a month');
  });

  it('uses today when there is no end date and handles bad input', () => {
    expect(durationLabel('2020-01-01', null, '2021-02-01')).toBe('1 yr 1 mo');
    expect(durationLabel('2022-01-01', '2021-01-01')).toBe('');
    expect(durationLabel(null)).toBe('');
  });
});

describe('profile record schemas', () => {
  const exp = { companyName: 'Acme', designation: 'Rep', employmentType: 'FULL_TIME', startDate: '2019-01-01', endDate: '2020-01-01', responsibilities: 'Sales' };

  it('experience: dates in order and not in the future', () => {
    expect(experienceSchema.safeParse(exp).success).toBe(true);
    expect(experienceSchema.safeParse({ ...exp, endDate: undefined }).success).toBe(true);
    expect(experienceSchema.safeParse({ ...exp, endDate: '2018-01-01' }).success).toBe(false);
    expect(experienceSchema.safeParse({ ...exp, startDate: '2999-01-01', endDate: undefined }).success).toBe(false);
    expect(experienceSchema.safeParse({ ...exp, employmentType: 'BOSS' }).success).toBe(false);
    expect(experienceSchema.safeParse({ ...exp, responsibilities: '' }).success).toBe(false);
  });

  it('education: completion date unless currently studying', () => {
    const edu = { qualificationLevel: 'BACHELORS', degreeTitle: 'BBA', institution: 'LUMS', startDate: '2013-09-01' };
    expect(educationSchema.safeParse(edu).success).toBe(false);
    expect(educationSchema.safeParse({ ...edu, currentlyStudying: true }).success).toBe(true);
    expect(educationSchema.safeParse({ ...edu, completionDate: '2017-06-30' }).success).toBe(true);
    expect(educationSchema.safeParse({ ...edu, completionDate: '2012-06-30' }).success).toBe(false);
  });

  it('certifications: expiry after issue and a safe verification link', () => {
    const c = { name: 'CSM', issuer: 'Scrum Alliance', issueDate: '2022-01-10' };
    expect(certificationSchema.safeParse(c).success).toBe(true);
    expect(certificationSchema.safeParse({ ...c, expiryDate: '2021-01-01' }).success).toBe(false);
    expect(certificationSchema.safeParse({ ...c, verificationUrl: 'ftp://x.com' }).success).toBe(false);
    expect(certificationSchema.parse({ ...c, verificationUrl: 'verify.example/1' }).verificationUrl).toBe('https://verify.example/1');
    expect(certificationSchema.safeParse({ ...c, fileId: 'not-a-uuid' }).success).toBe(false);
  });

  it('references: optional contact details validated when given', () => {
    const r = { name: 'Rana', organisation: 'Acme', relationship: 'Manager' };
    expect(referenceSchema.parse({ ...r, email: '', phone: '' })).toMatchObject({ email: undefined, phone: undefined });
    expect(referenceSchema.parse({ ...r, email: 'RANA@Acme.test', phone: '0321 1112223' })).toMatchObject({ email: 'rana@acme.test', phone: '+92 3211112223' });
    expect(referenceSchema.safeParse({ ...r, email: 'nope' }).success).toBe(false);
    expect(referenceSchema.safeParse({ ...r, phone: '+92 1' }).success).toBe(false);
    expect(referenceSchema.safeParse({ ...r, yearsKnown: -1 }).success).toBe(false);
  });

  it('"Add more" batches: 1–20 independent entries', () => {
    const batch = recordBatchSchema(experienceSchema);
    expect(batch.safeParse({ items: [] }).success).toBe(false);
    expect(batch.safeParse({ items: [exp, exp] }).success).toBe(true);
    expect(batch.safeParse({ items: Array.from({ length: 21 }, () => exp) }).success).toBe(false);
    expect(batch.safeParse({ items: [exp, { ...exp, endDate: '2000-01-01' }] }).success).toBe(false);
  });
});

describe('work from home requests', () => {
  it('needs a reason, dates in order and at most 31 days', () => {
    expect(wfhRequestSchema.safeParse({ startDate: '2026-11-16', endDate: '2026-11-18', reason: 'Plumber visit' }).success).toBe(true);
    expect(wfhRequestSchema.safeParse({ startDate: '2026-11-18', endDate: '2026-11-16', reason: 'Plumber visit' }).success).toBe(false);
    expect(wfhRequestSchema.safeParse({ startDate: '2026-11-01', endDate: '2026-12-15', reason: 'Long stay' }).success).toBe(false);
    expect(wfhRequestSchema.safeParse({ startDate: '2026-11-16', endDate: '2026-11-16', reason: '' }).success).toBe(false);
  });

  it('uses the same approvers as leave: Team Lead, then HR', () => {
    expect(WORKFLOWS.WORK_FROM_HOME.map((s) => [s.key, s.permission])).toEqual(WORKFLOWS.LEAVE.map((s) => [s.key, s.permission]));
  });
});

describe('dependents and self-service fields', () => {
  it('dependents: whole number, 0 or more, HR schemas only', () => {
    expect(employeeUpdateSchema.parse({ dependents: '3' }).dependents).toBe(3);
    expect(employeeUpdateSchema.safeParse({ dependents: -1 }).success).toBe(false);
    expect(employeeUpdateSchema.safeParse({ dependents: 1.5 }).success).toBe(false);
    expect('dependents' in employeeSchema.shape).toBe(true);
    // Employees cannot send it for themselves: the key is stripped.
    expect(selfProfileUpdateSchema.parse({ dependents: 5 } as never)).not.toHaveProperty('dependents');
  });

  it('employees may set the phone-privacy and no-experience switches', () => {
    expect(selfProfileUpdateSchema.parse({ hidePhone: true, noExperience: true })).toEqual({ hidePhone: true, noExperience: true });
  });
});
