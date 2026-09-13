export interface Template {
  name: string;
  url: string;
  category: string;
  free?: boolean;
}

const modules = import.meta.glob('../../Subscription/**/*.{jpg,jpeg,png,JPG,JPEG,PNG}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export const templatesByCategory: Record<string, Template[]> = {};

for (const path in modules) {
  const url = modules[path];
  const parts = path.split('/');
  const fileName = parts[parts.length - 1];
  const category = parts[parts.length - 2];
  const name = fileName.replace(/\.[^.]+$/, '');
  if (!templatesByCategory[category]) templatesByCategory[category] = [];
  templatesByCategory[category].push({ name, url, category });
}

const allTemplates = Object.values(templatesByCategory)
  .flat()
  .sort((left, right) => `${left.category}/${left.name}`.localeCompare(`${right.category}/${right.name}`));

for (const template of allTemplates.slice(0, 2)) {
  template.free = true;
}

export const templateCategories = Object.keys(templatesByCategory).sort();