"use client";

import type { Dispatch, SetStateAction } from "react";

export const MARKET = "30a" as const;

export const PROPERTY_TYPES = [
  { value: "standalone_home", label: "Standalone home" },
  { value: "condo_townhome", label: "Condo / townhome" },
  { value: "carriage_cottage", label: "Carriage cottage" },
  { value: "other", label: "Other" },
] as const;

export const BEACH_PROXIMITY = [
  { value: "beachfront", label: "Beachfront" },
  { value: "walkable", label: "Walkable to beach" },
  { value: "short_drive", label: "Short drive" },
  { value: "not_applicable", label: "Not applicable" },
] as const;

export type PropertyFormState = {
  property_name: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip: string;
  bedroom_count: string;
  sleeps: string;
  property_type: (typeof PROPERTY_TYPES)[number]["value"];
  beach_proximity: (typeof BEACH_PROXIMITY)[number]["value"];
  private_pool: boolean;
  positioning_statement: string;
};

export function emptyPropertyForm(): PropertyFormState {
  return {
    property_name: "",
    address_line1: "",
    address_line2: "",
    city: "",
    state: "FL",
    zip: "",
    bedroom_count: "1",
    sleeps: "",
    property_type: "standalone_home",
    beach_proximity: "walkable",
    private_pool: false,
    positioning_statement: "",
  };
}

export function propertyTypeLabel(
  value: string | null | undefined
): string {
  const o = PROPERTY_TYPES.find((x) => x.value === value);
  return o?.label ?? value ?? "—";
}

export function beachProximityLabel(
  value: string | null | undefined
): string {
  const o = BEACH_PROXIMITY.find((x) => x.value === value);
  return o?.label ?? value ?? "—";
}

type PropertyFieldsProps = {
  form: PropertyFormState;
  setForm: Dispatch<SetStateAction<PropertyFormState>>;
};

/** Renders fields from property name through bedroom count (inclusive). */
export function PropertyDetailsFieldsBeforeSleeps({
  form,
  setForm,
}: PropertyFieldsProps) {
  const patch = (p: Partial<PropertyFormState>) =>
    setForm((f) => ({ ...f, ...p }));

  return (
    <>
      <div>
        <label
          htmlFor="property_name"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Property name or nickname <span className="text-red-600">*</span>
        </label>
        <input
          id="property_name"
          type="text"
          required
          value={form.property_name}
          onChange={(e) => patch({ property_name: e.target.value })}
          className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
          placeholder="e.g. Mystic Cottage"
        />
      </div>

      <div>
        <label
          htmlFor="address_line1"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Address line 1 <span className="text-red-600">*</span>
        </label>
        <input
          id="address_line1"
          required
          value={form.address_line1}
          onChange={(e) => patch({ address_line1: e.target.value })}
          className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
        />
      </div>

      <div>
        <label
          htmlFor="address_line2"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Address line 2
        </label>
        <input
          id="address_line2"
          value={form.address_line2}
          onChange={(e) => patch({ address_line2: e.target.value })}
          className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="city"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            City <span className="text-red-600">*</span>
          </label>
          <input
            id="city"
            required
            value={form.city}
            onChange={(e) => patch({ city: e.target.value })}
            className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
          />
        </div>
        <div>
          <label
            htmlFor="state"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            State <span className="text-red-600">*</span>
          </label>
          <input
            id="state"
            required
            value={form.state}
            onChange={(e) => patch({ state: e.target.value })}
            className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="zip"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          ZIP <span className="text-red-600">*</span>
        </label>
        <input
          id="zip"
          required
          value={form.zip}
          onChange={(e) => patch({ zip: e.target.value })}
          className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
        />
      </div>

      <div>
        <label
          htmlFor="bedroom_count"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Bedroom count <span className="text-red-600">*</span>
        </label>
        <input
          id="bedroom_count"
          type="number"
          min={1}
          required
          value={form.bedroom_count}
          onChange={(e) => patch({ bedroom_count: e.target.value })}
          className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
        />
      </div>
    </>
  );
}

/** Sleeps — place immediately after bedroom count in the parent form. */
export function PropertySleepsField({ form, setForm }: PropertyFieldsProps) {
  const patch = (p: Partial<PropertyFormState>) =>
    setForm((f) => ({ ...f, ...p }));

  return (
    <div>
      <label
        htmlFor="sleeps"
        className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
      >
        Sleeps
      </label>
      <input
        id="sleeps"
        type="number"
        min={1}
        value={form.sleeps}
        onChange={(e) => patch({ sleeps: e.target.value })}
        placeholder="e.g. 8"
        className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
      />
      <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
        Total guests the property accommodates
      </p>
    </div>
  );
}

/** Renders property type, beach proximity, and private pool. */
export function PropertyDetailsFieldsAfterSleeps({
  form,
  setForm,
}: PropertyFieldsProps) {
  const patch = (p: Partial<PropertyFormState>) =>
    setForm((f) => ({ ...f, ...p }));

  return (
    <>
      <div>
        <label
          htmlFor="property_type"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Property type <span className="text-red-600">*</span>
        </label>
        <select
          id="property_type"
          required
          value={form.property_type}
          onChange={(e) =>
            patch({
              property_type: e.target
                .value as PropertyFormState["property_type"],
            })
          }
          className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
        >
          {PROPERTY_TYPES.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="beach_proximity"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Beach proximity <span className="text-red-600">*</span>
        </label>
        <select
          id="beach_proximity"
          required
          value={form.beach_proximity}
          onChange={(e) =>
            patch({
              beach_proximity: e.target
                .value as PropertyFormState["beach_proximity"],
            })
          }
          className="mt-1.5 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/20 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-400 dark:focus:ring-zinc-400/20"
        >
          {BEACH_PROXIMITY.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 dark:border-zinc-700 dark:bg-zinc-900/50">
        <input
          type="checkbox"
          checked={form.private_pool}
          onChange={(e) => patch({ private_pool: e.target.checked })}
          className="size-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 dark:border-zinc-600 dark:bg-zinc-800"
        />
        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
          Private pool
        </span>
      </label>
    </>
  );
}

export function validatePropertyForm(form: PropertyFormState): string | null {
  if (!form.property_name.trim()) {
    return "Please enter a property name or nickname.";
  }
  if (
    !form.address_line1.trim() ||
    !form.city.trim() ||
    !form.state.trim() ||
    !form.zip.trim()
  ) {
    return "Please fill in all required address fields.";
  }
  const beds = Number(form.bedroom_count);
  if (!Number.isFinite(beds) || beds < 1) {
    return "Bedroom count must be at least 1.";
  }
  if (form.sleeps.trim()) {
    const sl = Number(form.sleeps);
    if (!Number.isFinite(sl) || sl < 1) {
      return "Sleeps must be at least 1.";
    }
  }
  if (form.positioning_statement.length > 500) {
    return "Positioning statement must be 500 characters or fewer.";
  }
  return null;
}
