import { z } from "zod";

export const NormalizedAddressSchema = z.object({
  fullAddress: z.string().nullable(),
  address1: z.string().nullable(),
  address2: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string().nullable(),
});

export const NormalizedContactSchema = z.object({
  phones: z.array(z.string()),
  emails: z.array(z.string()),
  website: z.string().nullable(),
});

export const NormalizedHoursSchema = z.object({
  weekdayText: z.array(z.string()),
  notes: z.string().nullable(),
});

export const NormalizedResourceSchema = z.object({
  sourceSystem: z.string(),
  sourceRecordId: z.string().nullable(),
  name: z.string(),
  alternateNames: z.array(z.string()),
  description: z.string().nullable(),
  serviceTypes: z.array(z.string()),
  categories: z.array(z.string()),
  tags: z.array(z.string()),
  languages: z.array(z.string()),
  eligibility: z.array(z.string()),
  address: NormalizedAddressSchema,
  location: z.object({
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
  }),
  contact: NormalizedContactSchema,
  hours: NormalizedHoursSchema,
  rawMeta: z.object({
    recordUrl: z.string().nullable(),
    lastUpdated: z.string().nullable(),
  }),
});

export type NormalizedResource = z.infer<typeof NormalizedResourceSchema>;
