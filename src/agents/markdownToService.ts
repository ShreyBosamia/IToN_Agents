import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { htmlToBlocks } from '@portabletext/block-tools';
import {Schema} from "@sanity/schema"
import { JSDOM } from 'jsdom';
import { z } from 'zod';

/**
 * A Zod schema describing the expected shape of a service document in Sanity.
 * This aligns with the partner‑provided JSON structure, including latitude and
 * longitude in a `location` object and support for both detailed `periods` and
 * human‑readable `weekdayText` entries under `hoursOfOperation`.
 */
export const ServiceSanitySchema = z.object({
  name: z.string(),
  description: z.array(
    z.object({
      _type: z.literal('block'),
      children: z.array(
        z.object({
          _type: z.literal('span'),
          text: z.string(),
        }),
      ),
      markDefs: z.array(z.any()).optional(),
      style: z.string().optional(),
    }),
  ),
  address: z.string(),
  location: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
    })
    .optional(),
  serviceTypes: z.array(z.object({ _id: z.string() })),
  hoursOfOperation: z.object({
    periods: z
      .array(
        z.object({
          open: z.object({ day: z.number(), time: z.string() }),
          close: z.object({ day: z.number(), time: z.string() }),
        }),
      )
      .optional(),
    weekdayText: z.array(z.string()).optional(),
  }),
  contact: z.object({
    phone: z.string().optional(),
    email: z.string().optional(),
    website: z.string().optional(),
  }),
});

export interface ExtractedService {
  name: string;
  description: any[];
  address: string;
  location?: { latitude: number; longitude: number };
  serviceTypes: Array<{ _id: string }>;
  hoursOfOperation: {
    periods?: Array<{ open: { day: number; time: string }; close: { day: number; time: string } }>;
    weekdayText?: string[];
  };
  contact: {
    phone?: string;
    email?: string;
    website?: string;
  };
}

/**
 * Convert scraped Markdown and optional structured data into a service object
 * conforming to the partner‑provided Sanity schema.  The Markdown is first
 * converted to HTML using remark/rehype, then fed into Sanity's `htmlToBlocks`
 * helper to produce Portable Text.  Basic fields such as address,
 * coordinates, hours and contact information are extracted from any
 * `structuredData` objects (if provided), falling back to the Markdown title
 * when necessary.
 *
 * Note: This helper assumes the host project has installed `@portabletext/block-tools`
 * and `@sanity/schema`.  It also requires `jsdom` for HTML parsing.  If these
 * dependencies are missing at runtime, the caller must install them with
 * `npm install @portabletext/block-tools @sanity/schema jsdom unified remark-parse remark-rehype rehype-stringify`.
 */
export async function markdownToService(params: {
  title?: string;
  markdown: string;
  structuredData?: any;
}): Promise<ExtractedService> {
  const { title, markdown, structuredData } = params;
  // Convert Markdown → HTML
  const file = await unified().use(remarkParse).use(remarkRehype).use(rehypeStringify).process(markdown);
  const html = String(file);
  // Build a Sanity schema that closely mirrors the standard Portable Text
  // configuration.  The block definition includes styles, lists and marks
  // definitions so that `htmlToBlocks` has the information it needs to
  // deserialize HTML correctly.  Without these, the block tools may attempt
  // to read properties off undefined objects, resulting in errors like
  // `Cannot read properties of undefined (reading 'some')`.
  const compiledSchema = Schema.compile({
    name: 'serviceSchema',
    types: [
      {
        type: 'document',
        name: 'service',
        fields: [
          {
            name: 'description',
            type: 'array',
            of: [
              {
                type: 'block',
                // Define common heading styles.  Sanity uses these to map
                // <h1>, <h2>, etc.  Without at least one style entry the
                // block-tools library will throw when checking for styles.
                styles: [
                  { title: 'Normal', value: 'normal' },
                  { title: 'Heading 1', value: 'h1' },
                  { title: 'Heading 2', value: 'h2' },
                  { title: 'Heading 3', value: 'h3' },
                ],
                // Allow bullet and numbered lists
                lists: [
                  { title: 'Bullet', value: 'bullet' },
                  { title: 'Numbered', value: 'number' },
                ],
                // Define supported marks (decorators and annotations).  The
                // decorators array must be defined; otherwise htmlToBlocks
                // attempts to call `.some()` on an undefined value, which
                // causes the error seen in tests.
                marks: {
                  decorators: [
                    { title: 'Strong', value: 'strong' },
                    { title: 'Emphasis', value: 'em' },
                    { title: 'Underline', value: 'underline' },
                    { title: 'Code', value: 'code' },
                  ],
                  annotations: [
                    {
                      name: 'link',
                      type: 'object',
                      title: 'URL',
                      fields: [
                        {
                          name: 'href',
                          type: 'url',
                          title: 'URL',
                        },
                      ],
                    },
                  ],
                },
              },
              // Support for inline images.  Although not strictly necessary
              // for text-only service descriptions, including this definition
              // prevents errors if HTML contains <img> tags.
              {
                type: 'image',
                fields: [
                  { name: 'caption', type: 'string', title: 'Caption' },
                ],
                options: { hotspot: true },
              },
            ],
          },
        ],
      },
    ],
  });
  // Retrieve the compiled block content type from the document.  We find the
  // 'description' field on our 'service' document and use its type definition
  // directly.  Passing the entire type object (not its jsonType) is
  // required; the block-tools library inspects its nested properties.
  const blockContentType: any = compiledSchema
    .get('service')
    .fields.find((field: any) => field.name === 'description').type;
  let blocks: any[];
  try {
    blocks = htmlToBlocks(html, blockContentType, {
      parseHtml: (htmlString: string) => new JSDOM(htmlString).window.document,
    });
  } catch (err) {
    // If htmlToBlocks fails (e.g. due to unexpected HTML structure),
    // gracefully fallback to a simple text-only Portable Text array.  Split
    // the Markdown by blank lines and wrap each paragraph in a block with a
    // single span child.
    const paragraphs = markdown
      .split(/\n\s*\n/)
      .map((para) => para.trim())
      .filter(Boolean);
    blocks = paragraphs.map((para) => ({
      _type: 'block',
      children: [{ _type: 'span', text: para }],
      markDefs: [],
      style: 'normal',
    }));
  }

  // Initialise extracted fields
  let name: string = title || '';
  let address: string = '';
  let latitude: number | undefined;
  let longitude: number | undefined;
  let phone: string | undefined;
  let email: string | undefined;
  let website: string | undefined;
  const weekdayText: string[] = [];
  const periods: Array<{ open: { day: number; time: string }; close: { day: number; time: string } }> = [];

  // Helper to convert ISO weekday strings into numeric day indices (0 = Monday)
  const dayMap: Record<string, number> = {
    Monday: 0,
    Tuesday: 1,
    Wednesday: 2,
    Thursday: 3,
    Friday: 4,
    Saturday: 5,
    Sunday: 6,
  };

  if (structuredData && Array.isArray(structuredData)) {
    for (const obj of structuredData) {
      // Name
      if (!name && typeof obj.name === 'string') {
        name = obj.name;
      }
      // Address
      if (!address) {
        if (typeof obj.address === 'string') {
          address = obj.address;
        } else if (typeof obj.address === 'object' && obj.address) {
          // Many JSON-LD structures use PostalAddress objects
          address =
            obj.address.streetAddress ||
            obj.address.streetAddress1 ||
            [obj.address.addressLocality, obj.address.addressRegion, obj.address.postalCode]
              .filter(Boolean)
              .join(', ');
        }
      }
      // Coordinates
      if (obj.geo) {
        const lat = obj.geo.latitude ?? obj.geo.lat;
        const lng = obj.geo.longitude ?? obj.geo.lng;
        if (lat !== undefined && lng !== undefined && latitude === undefined && longitude === undefined) {
          latitude = parseFloat(lat);
          longitude = parseFloat(lng);
        }
      }
      // Contact info
      if (!phone && typeof obj.telephone === 'string') {
        phone = obj.telephone;
      }
      if (!email && typeof obj.email === 'string') {
        email = obj.email;
      }
      if (!website && typeof obj.url === 'string') {
        website = obj.url;
      }
      // Opening hours (structured)
      if (Array.isArray(obj.openingHoursSpecification)) {
        for (const spec of obj.openingHoursSpecification) {
          const dayStr: string | undefined = spec.dayOfWeek;
          const opens: string | undefined = spec.opens;
          const closes: string | undefined = spec.closes;
          if (dayStr && opens && closes) {
            // Convert to numeric day index; default to 0 (Monday) if unknown
            const dayIndex = dayMap[dayStr] ?? 0;
            // Remove colons so 9:00 becomes 900
            const openTime = opens.replace(/:/g, '');
            const closeTime = closes.replace(/:/g, '');
            periods.push({
              open: { day: dayIndex, time: openTime },
              close: { day: dayIndex, time: closeTime },
            });
            weekdayText.push(`${dayStr}: ${opens} – ${closes}`);
          }
        }
      }
      // Opening hours (simple array)
      if (Array.isArray(obj.openingHours)) {
        weekdayText.push(...obj.openingHours);
      }
    }
  }

  return {
    name: name || '',
    description: blocks,
    address: address || '',
    location:
      latitude !== undefined && longitude !== undefined
        ? { latitude: Number(latitude), longitude: Number(longitude) }
        : undefined,
    serviceTypes: [], // classification must be handled separately
    hoursOfOperation: {
      periods: periods.length > 0 ? periods : undefined,
      weekdayText: weekdayText.length > 0 ? weekdayText : undefined,
    },
    contact: {
      phone,
      email,
      website,
    },
  };
}