/**
 * Who to search first when writing "Then and now" for a food (the user's decision, 2026-11-21), and which
 * cultures stay out. Developer-only list: nothing here reaches the app. A research agent searches every
 * writer below for the food and its other names, so nothing a well-known writer said is missed; each
 * belief is still only added when the passage was opened and confirmed (a translation link, or a paper).
 */
export interface AncientWriter {
  name: string;
  /** Works most likely to mention foods, drinks and diet. */
  works: string;
}

export const ANCIENT_WRITERS: readonly AncientWriter[] = [
  { name: "Hippocrates and the Hippocratic Corpus", works: "Regimen, Regimen in Acute Diseases, Diseases of Women, Affections" },
  { name: "Aristotle and the Peripatetics", works: "History of Animals, Problems, Parts of Animals" },
  { name: "Theophrastus", works: "Enquiry into Plants, Causes of Plants" },
  { name: "Dioscorides", works: "De Materia Medica" },
  { name: "Galen", works: "On the Properties of Foodstuffs, On the Powers of Simple Drugs, Hygiene" },
  { name: "Pliny the Elder", works: "Natural History, books 12 to 32" },
  { name: "Celsus", works: "De Medicina" },
  { name: "Athenaeus", works: "Deipnosophistae (the Learned Banqueters)" },
  { name: "Plato", works: "Republic, Laws, Timaeus" },
  { name: "Herodotus", works: "Histories" },
  { name: "Homer", works: "Iliad and Odyssey" },
  { name: "Hesiod", works: "Works and Days, Theogony" },
  { name: "Xenophon", works: "Cyropaedia, Memorabilia, Anabasis" },
  { name: "Plutarch", works: "Moralia, Table Talk, Lives" },
  { name: "Pausanias", works: "Description of Greece (the Olympic Games and athletes)" },
  { name: "Philostratus", works: "Gymnasticus (athletes' training and diet)" },
  { name: "Diogenes Laertius", works: "Lives of the Eminent Philosophers" },
  { name: "Cato the Elder", works: "On Agriculture" },
  { name: "Varro", works: "On Agriculture" },
  { name: "Columella", works: "On Agriculture" },
  { name: "Virgil", works: "Georgics, Eclogues" },
  { name: "Ovid", works: "Metamorphoses, Fasti" },
  { name: "Horace and Martial", works: "Satires, Epigrams" },
  { name: "Apicius", works: "De re coquinaria (Roman cookery)" },
  { name: "Strabo", works: "Geography" },
  { name: "Aelian", works: "On the Nature of Animals" },
  { name: "Oribasius and Paul of Aegina", works: "Medical Collections, Medical Compendium" },
  { name: "Egyptian medical papyri", works: "Ebers, Edwin Smith, Hearst, Kahun" },
  { name: "Hebrew Bible and the Talmud", works: "Genesis to Chronicles, Yoma, Berakhot, Shabbat" },
  { name: "New Testament", works: "The Gospels" },
];

/** Cultures kept out of "Then and now" (the user's decision, 2026-11-21: their records aren't of the quality of the Greek, Roman and Egyptian ones). */
export const BLOCKED_PATTERN = /\b(india|indian|ayurved\w*|islam\w*|muslim\w*|qur'?an\w*|koran|hadith|unani|tahnik|sunnah)\b/i;

/**
 * Foods written before the list (2026-10-30). Their pages are left as they were until the user decides;
 * every food added after this is checked against the blocked cultures.
 */
export const BEFORE_THE_BLOCK_LIST: readonly string[] = ["evoo", "ginger", "grapes", "pomegranate"];
