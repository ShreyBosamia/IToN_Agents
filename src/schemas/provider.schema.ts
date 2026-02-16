import { z } from "zod";

const SanitySpan = z.object({
  _type: z.literal("span"),
  text: z.string(),
});

const SanityBlock = z.object({
  _type: z.literal("block"),
  children: z.array(SanitySpan).min(1),
  markDefs: z.array(z.any()),
  style: z.string(),
});

const TimeHHMM = z.string().regex(/^\d{4}$/);
const Day0to6 = z.number().int().min(0).max(6);

const Address = z.union([z.string(), z.null()]);

export const ProviderSchema = z.object({
  name: z.string().min(1),
  description: z.array(SanityBlock).min(1),

  address: Address,

  location: z.object({
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
  }),

  serviceTypes: z.array(z.object({ _id: z.string().min(1) })).min(1),

  hoursOfOperation: z
    .object({
      periods: z
        .array(
          z.object({
            open: z.object({ day: Day0to6, time: TimeHHMM }),
            close: z.object({ day: Day0to6, time: TimeHHMM }),
          })
        )
        .nullable()
        .optional(),
      weekdayText: z.array(z.string()).nullable().optional(),
    })
    .optional(),

  contact: z
    .object({
      phone: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
      website: z.string().nullable().optional(),
    })
    .passthrough(),
});

export const ProviderArraySchema = z.array(ProviderSchema);
