import { describe, expect, it } from 'vitest';

import {
  buildSanityDocFromEvidence,
  collectPageEvidenceFromScrapedPage,
  mergeSanityDocs,
  rankTargetPageLinks,
} from '../pipeline/runPipeline.ts';
import type { ScrapeLink, ScrapePayload, ScrapeProviderName } from '../src/tools/scrapeWebsite.ts';

function makePayload(args: {
  url: string;
  finalUrl?: string;
  provider?: ScrapeProviderName;
  title?: string;
  description?: string;
  text?: string;
  links?: ScrapeLink[];
  ld_json?: unknown[];
}): ScrapePayload {
  return {
    url: args.url,
    final_url: args.finalUrl ?? args.url,
    status: 200,
    fetched_at: '2026-01-01T00:00:00.000Z',
    finished_at: '2026-01-01T00:00:01.000Z',
    headers: {},
    provider: args.provider ?? 'firecrawl',
    provider_attempts: [{ provider: args.provider ?? 'firecrawl', ok: true, status: 200 }],
    raw_provider_metadata: {},
    metadata: {
      title: args.title ?? '',
      description: args.description ?? '',
      keywords: [],
      canonical: args.finalUrl ?? args.url,
      robots: 'index,follow',
      og: {
        title: '',
        description: '',
        locale: '',
        url: '',
      },
      ld_json: args.ld_json ?? [],
    },
    data: {
      text: args.text ?? '',
      links: args.links ?? [],
      htmlSnippet: '<html></html>',
    },
    truncated: {
      text: false,
      html: false,
    },
  };
}

describe('rankTargetPageLinks', () => {
  it('prefers relevant same-domain support pages and excludes junk links', () => {
    const links: ScrapeLink[] = [
      { href: 'https://example.org/contact-us', text: 'Contact Us', rel: '' },
      { href: 'https://example.org/hours', text: 'Hours', rel: '' },
      { href: 'https://example.org/services', text: 'Services', rel: '' },
      { href: 'https://example.org/faq', text: 'FAQ', rel: '' },
      { href: 'https://facebook.com/example', text: 'Facebook', rel: '' },
      { href: 'https://example.org/brochure.pdf', text: 'Brochure', rel: '' },
      { href: 'https://example.org/volunteer', text: 'Volunteer', rel: '' },
    ];

    const ranked = rankTargetPageLinks(links, 'https://example.org', 5);

    expect(ranked.map((item) => item.url)).toContain('https://example.org/contact-us');
    expect(ranked.map((item) => item.url)).toContain('https://example.org/hours');
    expect(ranked.map((item) => item.url)).toContain('https://example.org/services');
    expect(ranked.map((item) => item.url)).not.toContain('https://facebook.com/example');
    expect(ranked.map((item) => item.url)).not.toContain('https://example.org/brochure.pdf');
    expect(ranked.map((item) => item.url)).not.toContain('https://example.org/volunteer');
    expect(ranked.some((item) => item.intent === 'contact')).toBe(true);
    expect(ranked.some((item) => item.intent === 'hours')).toBe(true);
  });

  it('filters news-like links so deep story pages do not become canonical candidates', () => {
    const links: ScrapeLink[] = [
      { href: 'https://example.org/contact', text: 'Contact', rel: '' },
      { href: 'https://example.org/news/program-update', text: 'Program Update', rel: '' },
      { href: 'https://example.org/stories/client-story', text: 'Client Story', rel: '' },
      { href: 'https://example.org/services/shelter', text: 'Shelter Services', rel: '' },
    ];

    const ranked = rankTargetPageLinks(links, 'https://example.org', 5);

    expect(ranked.map((item) => item.url)).toContain('https://example.org/contact');
    expect(ranked.map((item) => item.url)).toContain('https://example.org/services/shelter');
    expect(ranked.map((item) => item.url)).not.toContain('https://example.org/news/program-update');
    expect(ranked.map((item) => item.url)).not.toContain(
      'https://example.org/stories/client-story'
    );
  });
});

describe('collectPageEvidenceFromScrapedPage', () => {
  it('extracts address, phone, email, and hours candidates from a contact page', () => {
    const payload = makePayload({
      url: 'https://example.org/contact',
      title: 'Contact Us',
      text: [
        'Contact Us',
        '123 Main Street',
        'Portland, OR 97205',
        'Hours',
        'Monday: 9:00 AM - 5:00 PM',
        'Call us at (503) 555-1234',
        'Email hello@example.org',
      ].join('\n'),
      links: [
        { href: 'tel:+15035551234', text: 'Call', rel: '' },
        { href: 'mailto:hello@example.org', text: 'Email', rel: '' },
      ],
    });

    const evidence = collectPageEvidenceFromScrapedPage(payload, 'contact', 'FOOD_BANK');

    expect(evidence.addressCandidates.map((item) => item.value)).toContain(
      '123 Main Street, Portland, OR 97205'
    );
    expect(evidence.phoneCandidates.map((item) => item.value)).toContain('+15035551234');
    expect(evidence.emailCandidates.map((item) => item.value)).toContain('hello@example.org');
    expect(evidence.hoursCandidates).toHaveLength(1);
    expect(evidence.hoursCandidates[0].value.weekdayText).toContain('Monday: 9:00 AM - 5:00 PM');
  });
});

describe('buildSanityDocFromEvidence', () => {
  it('prefers specific pages for contact and hours while keeping homepage description', () => {
    const home = collectPageEvidenceFromScrapedPage(
      makePayload({
        url: 'https://example.org',
        title: 'Example Resource Center | Serving families',
        description: 'Homepage description',
        text: 'Welcome to Example Resource Center. Call 111-111-1111 for general info.',
      }),
      'home',
      'FOOD_BANK'
    );

    const contact = collectPageEvidenceFromScrapedPage(
      makePayload({
        url: 'https://example.org/contact',
        title: 'Contact Us',
        text: [
          'Visit Us',
          '123 Main Street',
          'Portland, OR 97205',
          'Phone: (503) 555-1234',
          'Email: hello@example.org',
        ].join('\n'),
        links: [{ href: 'tel:+15035551234', text: 'Phone', rel: '' }],
      }),
      'contact',
      'FOOD_BANK'
    );

    const hours = collectPageEvidenceFromScrapedPage(
      makePayload({
        url: 'https://example.org/hours',
        title: 'Hours',
        text: 'Hours\nMonday: 9:00 AM - 5:00 PM\nTuesday: 9:00 AM - 5:00 PM',
      }),
      'hours',
      'FOOD_BANK'
    );

    const services = collectPageEvidenceFromScrapedPage(
      makePayload({
        url: 'https://example.org/services/wellness',
        title: 'Wellness Program',
        text: 'Our wellness and family services are available here.',
      }),
      'program',
      'FOOD_BANK'
    );

    const doc = buildSanityDocFromEvidence(
      [home, contact, hours, services],
      'FOOD_BANK',
      'https://example.org'
    );

    expect(doc.name).toBe('Example Resource Center');
    expect(doc.description[0].children[0].text).toBe('Homepage description');
    expect(doc.address).toBe('123 Main Street, Portland, OR 97205');
    expect(doc.contact.phone).toBe('+15035551234');
    expect(doc.contact.email).toBe('hello@example.org');
    expect(doc.hoursOfOperation.weekdayText).toContain('Monday: 9:00 AM - 5:00 PM');
    expect(doc.serviceTypes.map((item) => item._id)).toEqual(
      expect.arrayContaining(['FOOD_BANK', 'wellness', 'family_services'])
    );
  });

  it('uses repeated agreement across pages over a singleton low-specificity value', () => {
    const home = collectPageEvidenceFromScrapedPage(
      makePayload({
        url: 'https://example.org',
        title: 'Example',
        text: 'Visit us at 999 Old Road, Portland, OR 97201',
      }),
      'home',
      'SHELTER'
    );

    const locationPage = collectPageEvidenceFromScrapedPage(
      makePayload({
        url: 'https://example.org/location',
        title: 'Location',
        text: '123 Main Street\nPortland, OR 97205',
      }),
      'location',
      'SHELTER'
    );

    const programPage = collectPageEvidenceFromScrapedPage(
      makePayload({
        url: 'https://example.org/program',
        title: 'Shelter Program',
        text: 'Program Address\n123 Main Street\nPortland, OR 97205',
      }),
      'program',
      'SHELTER'
    );

    const doc = buildSanityDocFromEvidence(
      [home, locationPage, programPage],
      'SHELTER',
      'https://example.org'
    );

    expect(doc.address).toBe('123 Main Street, Portland, OR 97205');
  });

  it('keeps the org-level homepage identity over a deep news page candidate', () => {
    const home = collectPageEvidenceFromScrapedPage(
      makePayload({
        url: 'https://example.org',
        title: 'Transition Projects',
        text: 'Transition Projects provides shelter and housing support across Portland.',
      }),
      'home',
      'SHELTER'
    );

    const story = collectPageEvidenceFromScrapedPage(
      makePayload({
        url: 'https://example.org/news/se-grand',
        title: 'SE Grand Recovery Shelter',
        text: 'SE Grand Recovery Shelter offers recovery-focused shelter beds.',
      }),
      'program',
      'SHELTER'
    );

    const doc = buildSanityDocFromEvidence([home, story], 'SHELTER', 'https://example.org');

    expect(doc.name).toBe('Transition Projects');
    expect(doc.contact.website).toBe('https://example.org/');
  });

  it('preserves the target service page as website over generic support pages', () => {
    const servicePage = collectPageEvidenceFromScrapedPage(
      makePayload({
        url: 'https://example.org/services/homeless-services',
        title: 'Homeless Services',
        text: 'Homeless services are offered here.',
      }),
      'home',
      'SHELTER'
    );

    const contactPage = collectPageEvidenceFromScrapedPage(
      makePayload({
        url: 'https://example.org/contact',
        title: 'Contact',
        text: 'Call our office for more information.',
      }),
      'contact',
      'SHELTER'
    );

    const doc = buildSanityDocFromEvidence(
      [servicePage, contactPage],
      'SHELTER',
      'https://example.org/services/homeless-services'
    );

    expect(doc.contact.website).toBe('https://example.org/services/homeless-services');
  });

  it('does not promote a child location address into an aggregate service page record', () => {
    const aggregate = collectPageEvidenceFromScrapedPage(
      makePayload({
        url: 'https://example.org/emergency-shelters',
        title: 'Emergency Shelters',
        text: 'Find support and shelter resources across our locations.',
      }),
      'home',
      'SHELTER'
    );

    const locationOne = collectPageEvidenceFromScrapedPage(
      makePayload({
        url: 'https://example.org/locations/east',
        title: 'East Shelter',
        text: '123 Main Street\nPortland, OR 97205',
      }),
      'location',
      'SHELTER'
    );

    const locationTwo = collectPageEvidenceFromScrapedPage(
      makePayload({
        url: 'https://example.org/locations/west',
        title: 'West Shelter',
        text: '456 Oak Avenue\nPortland, OR 97209',
      }),
      'location',
      'SHELTER'
    );

    const doc = buildSanityDocFromEvidence(
      [aggregate, locationOne, locationTwo],
      'SHELTER',
      'https://example.org/emergency-shelters'
    );

    expect(doc.address).toBe('');
  });

  it('prefers an org-facing contact page over branch pages for flat address and contact fields', () => {
    const home = collectPageEvidenceFromScrapedPage(
      makePayload({
        url: 'https://example.org/services/shelters',
        title: 'Shelter Services',
        text: 'Shelter services available across our sites.',
      }),
      'home',
      'SHELTER'
    );

    const contact = collectPageEvidenceFromScrapedPage(
      makePayload({
        url: 'https://example.org/contact',
        title: 'Contact Us',
        text: [
          'Main Office',
          '500 Service Way',
          'Portland, OR 97205',
          'Phone: (503) 555-1234',
          'Email: info@example.org',
        ].join('\n'),
        links: [
          { href: 'tel:+15035551234', text: 'Call', rel: '' },
          { href: 'mailto:info@example.org', text: 'Email', rel: '' },
        ],
      }),
      'contact',
      'SHELTER'
    );

    const branch = collectPageEvidenceFromScrapedPage(
      makePayload({
        url: 'https://example.org/locations/east',
        title: 'East Shelter',
        text: [
          '123 Main Street',
          'Portland, OR 97205',
          'Phone: (503) 555-9999',
          'Email: east@example.org',
        ].join('\n'),
        links: [
          { href: 'tel:+15035559999', text: 'Call', rel: '' },
          { href: 'mailto:east@example.org', text: 'Email', rel: '' },
        ],
      }),
      'location',
      'SHELTER'
    );

    const doc = buildSanityDocFromEvidence(
      [home, contact, branch],
      'SHELTER',
      'https://example.org/services/shelters'
    );

    expect(doc.address).toBe('500 Service Way, Portland, OR 97205');
    expect(doc.contact.phone).toBe('+15035551234');
    expect(doc.contact.email).toBe('info@example.org');
  });
});

describe('mergeSanityDocs', () => {
  it('replaces null strings, short-code phones, and deep page websites with better enrichment', () => {
    const primary = {
      name: 'SE Grand Recovery Shelter',
      description: [
        {
          _type: 'block' as const,
          children: [{ _type: 'span' as const, text: 'null' }],
          markDefs: [] as [],
          style: 'normal' as const,
        },
      ],
      address: 'null',
      location: { latitude: null, longitude: null },
      serviceTypes: [{ _id: 'SHELTER' }],
      hoursOfOperation: { periods: [], weekdayText: ['Monday: 9:00 AM - 5:00 PM'] },
      contact: {
        phone: '211',
        email: 'null',
        website: 'https://example.org/news/se-grand',
      },
    };

    const enrichment = {
      name: 'Transition Projects',
      description: [
        {
          _type: 'block' as const,
          children: [{ _type: 'span' as const, text: 'Organization description' }],
          markDefs: [] as [],
          style: 'normal' as const,
        },
      ],
      address: '665 Northwest Hoyt Street, Portland, OR 97209',
      location: { latitude: 45.0, longitude: -122.0 },
      serviceTypes: [{ _id: 'housing' }],
      hoursOfOperation: {
        periods: [],
        weekdayText: ['Monday: 9:00 AM - 5:00 PM', 'Tuesday: 9:00 AM - 5:00 PM'],
      },
      contact: {
        phone: '503-280-4700',
        email: 'hello@example.org',
        website: 'https://example.org/shelters',
      },
    };

    const merged = mergeSanityDocs(primary, enrichment, 'SHELTER', 'https://example.org/shelters');

    expect(merged.name).toBe('Transition Projects');
    expect(merged.address).toBe('665 Northwest Hoyt Street, Portland, OR 97209');
    expect(merged.contact.phone).toBe('503-280-4700');
    expect(merged.contact.email).toBe('hello@example.org');
    expect(merged.contact.website).toBe('https://example.org/shelters');
    expect(merged.hoursOfOperation.weekdayText).toHaveLength(2);
  });

  it('prefers a clean enrichment address when the primary address is a concatenated composite', () => {
    const primary = {
      name: 'Portland Emergency Overnight Shelters',
      description: [
        {
          _type: 'block' as const,
          children: [{ _type: 'span' as const, text: 'Shelter services' }],
          markDefs: [] as [],
          style: 'normal' as const,
        },
      ],
      address: '30 SW 2nd AveCentennial Neighborhood Shelter - 3130 SE 148th Ave',
      location: { latitude: null, longitude: null },
      serviceTypes: [{ _id: 'SHELTER' }],
      hoursOfOperation: { periods: [], weekdayText: [] },
      contact: {
        phone: '503-823-1340',
        email: 'shelterservices@example.org',
        website: 'https://example.org/overnight-emergency-shelters',
      },
    };

    const enrichment = {
      name: 'Portland Emergency Overnight Shelters',
      description: [
        {
          _type: 'block' as const,
          children: [{ _type: 'span' as const, text: 'Shelter services' }],
          markDefs: [] as [],
          style: 'normal' as const,
        },
      ],
      address: '30 SW 2nd Ave, Portland, OR 97204',
      location: { latitude: null, longitude: null },
      serviceTypes: [{ _id: 'SHELTER' }],
      hoursOfOperation: { periods: [], weekdayText: [] },
      contact: {
        phone: '503-823-1340',
        email: 'shelterservices@example.org',
        website: 'https://example.org/overnight-emergency-shelters',
      },
    };

    const merged = mergeSanityDocs(
      primary,
      enrichment,
      'SHELTER',
      'https://example.org/overnight-emergency-shelters'
    );

    expect(merged.address).toBe('30 SW 2nd Ave, Portland, OR 97204');
  });
});
