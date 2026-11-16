export type DictField =
  | { key: string; label: string; type?: "choice"; options: { value: string; label: string }[]; multi?: boolean; required?: boolean }
  | { key: string; label: string; type: "number"; unit: string; min?: number; max?: number; required?: boolean }
  | { key: string; label: string; type: "text"; placeholder?: string; required?: boolean };

/** Returns an error message when a numeric value is invalid or out of the field's range. */
export function numberError(f: DictField, raw: string | string[] | undefined): string | null {
  if (f.type !== "number" || raw === undefined || raw === "" || Array.isArray(raw)) return null;
  const v = Number(String(raw).replace(",", "."));
  if (!isFinite(v)) return "Não é um número";
  if (f.min !== undefined && v < f.min) return `Mínimo ${f.min}${f.unit ? " " + f.unit : ""}`;
  if (f.max !== undefined && v > f.max) return `Máximo ${f.max}${f.unit ? " " + f.unit : ""}`;
  return null;
}

export type DictGroup = {
  key: string;
  title: string;
  fields: DictField[];
};

export type Ficha = {
  key: string;
  title: string;
  short: string;
  description: string;
  groups: DictGroup[];
};

const o = (...labels: string[]) => labels.map((l) => ({ value: l, label: l }));
// Physical quantities default to non-negative; ranges below tighten specific ones.
const RANGES: Record<string, [number | undefined, number | undefined]> = {
  ph: [0, 14],
  dossel: [0, 100],
  temp_agua: [-5, 50],
  prof_topo: [0, 2000],
  prof_base: [0, 2000],
  od: [0, 25],
  ce: [0, 100000],
  turbidez: [0, 10000],
  velocidade: [0, 20],
  altura: [0, 120],
  dap: [0, 1000],
};
const num = (key: string, label: string, unit: string): DictField => {
  const [min, max] = RANGES[key] ?? [0, undefined];
  return { key, label, type: "number", unit, min, max };
};
const txt = (key: string, label: string, placeholder?: string): DictField => ({ key, label, type: "text", placeholder });

// ---------- Shared groups (same attribute keys wherever they appear) ----------

const intemperismo: DictGroup = {
  key: "intemperismo",
  title: "Intemperismo",
  fields: [
    {
      key: "grau",
      label: "Grau de intemperismo",
      options: o("Rocha sã", "Pouco intemperizada", "Moderadamente intemperizada", "Muito intemperizada", "Saprolito", "Solo residual (acebolamento)"),
    },
  ],
};

const usoMapBiomas = o(
  "Formação florestal",
  "Formação savânica",
  "Mangue",
  "Silvicultura",
  "Campo alagado / área pantanosa",
  "Formação campestre",
  "Pastagem",
  "Lavoura temporária (soja, milho…)",
  "Cana",
  "Lavoura perene (café, citrus…)",
  "Mosaico de usos",
  "Área urbanizada",
  "Mineração",
  "Praia / duna",
  "Afloramento rochoso",
  "Rio, lago ou represa",
  "Outra área não vegetada",
);

// ---------- Fichas temáticas ----------

export const fichas: Ficha[] = [
  {
    key: "geomorfologia",
    title: "Geomorfologia e erosão",
    short: "Geomorfologia",
    description: "Formas de relevo, processos erosivos, voçorocas e movimentos de massa",
    groups: [
      {
        key: "relevo",
        title: "Relevo",
        fields: [
          {
            key: "forma",
            label: "Forma / compartimento",
            options: o("Topo / interflúvio", "Encosta convexa", "Encosta côncava", "Encosta retilínea", "Fundo de vale", "Planície fluvial", "Terraço", "Rampa de colúvio", "Escarpa", "Cabeceira de drenagem"),
          },
          { key: "posicao", label: "Posição na vertente", options: o("Topo", "Terço superior", "Terço médio", "Terço inferior", "Sopé") },
          {
            key: "declividade",
            label: "Declividade (Embrapa)",
            options: o("Plano 0–3%", "Suave ondulado 3–8%", "Ondulado 8–20%", "Forte ondulado 20–45%", "Montanhoso 45–75%", "Escarpado >75%"),
          },
        ],
      },
      {
        key: "escoamento",
        title: "Escoamento e dinâmica hídrica",
        fields: [
          {
            key: "tipo",
            label: "Feições",
            multi: true,
            options: o("Difuso (laminar)", "Sulcos", "Ravinamento ativo", "Voçoroca", "Surgência de água (piping)", "Alcovas de regressão", "Depósito de fundo"),
          },
          { key: "umidade", label: "Condição", options: o("Seco", "Úmido", "Saturado", "Fluxo ativo") },
        ],
      },
      {
        key: "feicao",
        title: "Dimensões da feição",
        fields: [num("comprimento", "Comprimento", "m"), num("largura", "Largura", "m"), num("profundidade", "Profundidade", "m")],
      },
      {
        key: "ruptura",
        title: "Mecanismo de ruptura",
        fields: [
          {
            key: "mecanismo",
            label: "Mecanismo",
            multi: true,
            options: o("Queda de blocos", "Tombamento", "Rastejo", "Escorregamento planar", "Escorregamento rotacional", "Corrida / fluxo", "Solapamento basal"),
          },
          { key: "atividade", label: "Atividade", options: o("Ativo", "Reativado", "Inativo", "Estabilizado") },
        ],
      },
      intemperismo,
    ],
  },
  {
    key: "solos",
    title: "Solos (descrição morfológica)",
    short: "Solos",
    description: "Horizontes, cor Munsell, textura, estrutura, consistência e classificação SiBCS",
    groups: [
      {
        key: "solo",
        title: "Horizonte",
        fields: [
          { key: "horizonte", label: "Horizonte", options: o("O", "A", "AB", "B", "BC", "C", "R") },
          num("prof_topo", "Profundidade do topo", "cm"),
          num("prof_base", "Profundidade da base", "cm"),
          txt("munsell", "Cor Munsell (úmida)", "Ex.: 2.5YR 3/6"),
          {
            key: "cor",
            label: "Cor (descrição)",
            options: o("Bruno-escura", "Bruno-avermelhada", "Vermelha", "Vermelho-escura (terra roxa)", "Amarela", "Bruno-amarelada", "Cinzenta", "Preta", "Variegada / mosqueada"),
          },
          { key: "textura", label: "Textura", options: o("Arenosa", "Média (franco)", "Siltosa", "Argilosa", "Muito argilosa", "Cascalhenta") },
          { key: "estrutura", label: "Estrutura", options: o("Granular", "Blocos subangulares", "Blocos angulares", "Prismática", "Laminar", "Maciça", "Grãos simples") },
          { key: "consistencia", label: "Consistência (úmido)", options: o("Solta", "Muito friável", "Friável", "Firme", "Muito firme", "Extremamente firme") },
          { key: "raizes", label: "Raízes", options: o("Ausentes", "Raras", "Comuns", "Abundantes") },
        ],
      },
      {
        key: "perfil",
        title: "Perfil e classificação",
        fields: [
          {
            key: "drenagem",
            label: "Drenagem",
            options: o("Excessivamente", "Fortemente", "Acentuadamente", "Bem drenado", "Moderadamente", "Imperfeitamente", "Mal drenado", "Muito mal drenado"),
          },
          { key: "pedregosidade", label: "Pedregosidade", options: o("Não pedregoso", "Ligeiramente", "Moderadamente", "Pedregoso", "Muito pedregoso") },
          {
            key: "sibcs",
            label: "Ordem (SiBCS)",
            options: o("Argissolo", "Cambissolo", "Chernossolo", "Espodossolo", "Gleissolo", "Latossolo", "Luvissolo", "Neossolo", "Nitossolo", "Organossolo", "Planossolo", "Plintossolo", "Vertissolo"),
          },
        ],
      },
      intemperismo,
    ],
  },
  {
    key: "geologia",
    title: "Geologia e afloramentos",
    short: "Geologia",
    description: "Litologia, estruturas, fraturas e atitude de camadas (use o clinômetro)",
    groups: [
      {
        key: "litologia",
        title: "Litologia",
        fields: [
          {
            key: "rocha",
            label: "Rocha / material",
            options: o("Basalto", "Diabásio", "Arenito", "Siltito", "Argilito / folhelho", "Conglomerado", "Calcário", "Granito", "Gnaisse", "Xisto", "Quartzito", "Depósito aluvionar", "Colúvio", "Tálus"),
          },
          { key: "afloramento", label: "Tipo de exposição", options: o("Afloramento natural", "Corte de estrada", "Leito de rio", "Pedreira / cava", "Matacão") },
        ],
      },
      {
        key: "estrutura_geo",
        title: "Estruturas",
        fields: [
          {
            key: "tipo",
            label: "Estrutura medida",
            multi: true,
            options: o("Acamamento", "Fratura / junta", "Falha", "Foliação", "Lineação", "Dique", "Disjunção colunar", "Vesículas / amígdalas"),
          },
          num("espacamento", "Espaçamento das fraturas", "cm"),
          num("abertura", "Abertura das fraturas", "mm"),
          { key: "preenchimento", label: "Preenchimento", options: o("Vazio", "Argila", "Óxidos", "Quartzo / calcita", "Raízes", "Água") },
        ],
      },
      intemperismo,
    ],
  },
  {
    key: "hidrologia",
    title: "Hidrologia e qualidade da água",
    short: "Hidrologia",
    description: "Corpo d'água, parâmetros de sonda, seção do canal e vazão estimada",
    groups: [
      {
        key: "corpo_agua",
        title: "Corpo d'água",
        fields: [
          { key: "tipo", label: "Tipo", options: o("Nascente", "Rio / córrego", "Lago / represa", "Poço", "Banhado / várzea", "Canal artificial", "Açude") },
          { key: "regime", label: "Regime", options: o("Perene", "Intermitente", "Efêmero") },
          { key: "aspecto", label: "Aspecto da água", multi: true, options: o("Límpida", "Turva", "Com odor", "Espuma", "Óleo", "Algas / eutrofização", "Lixo") },
          { key: "mata_ciliar", label: "Mata ciliar", options: o("Preservada", "Parcial", "Ausente") },
        ],
      },
      {
        key: "qualidade",
        title: "Parâmetros (sonda multiparâmetro)",
        fields: [
          num("ph", "pH", ""),
          num("ce", "Condutividade elétrica", "µS/cm"),
          num("od", "Oxigênio dissolvido", "mg/L"),
          num("turbidez", "Turbidez", "NTU"),
          num("temp_agua", "Temperatura da água", "°C"),
          num("tds", "Sólidos dissolvidos totais", "mg/L"),
        ],
      },
      {
        key: "secao",
        title: "Seção e vazão",
        fields: [
          num("largura", "Largura molhada", "m"),
          num("profundidade", "Profundidade média", "m"),
          num("velocidade", "Velocidade (flutuador)", "m/s"),
          num("vazao", "Vazão estimada", "m³/s"),
        ],
      },
    ],
  },
  {
    key: "vegetacao",
    title: "Vegetação e uso da terra",
    short: "Vegetação / uso",
    description: "Classe de uso (legenda MapBiomas), estágio sucessional e estrutura da vegetação",
    groups: [
      {
        key: "uso",
        title: "Uso e cobertura",
        fields: [
          { key: "classe", label: "Classe (MapBiomas)", options: usoMapBiomas },
          { key: "estado", label: "Estado", multi: true, options: o("Conservado", "Degradado", "Queimada recente", "Corte seletivo", "Em regeneração", "Gado presente") },
        ],
      },
      {
        key: "vegetacao",
        title: "Estrutura da vegetação",
        fields: [
          { key: "estagio", label: "Estágio sucessional", options: o("Inicial", "Médio", "Avançado", "Primária") },
          { key: "estrato", label: "Estratos presentes", multi: true, options: o("Herbáceo", "Arbustivo", "Arbóreo", "Emergentes", "Epífitas", "Lianas") },
          num("dossel", "Cobertura do dossel", "%"),
          num("altura", "Altura média do dossel", "m"),
          num("dap", "DAP médio", "cm"),
          txt("especies", "Espécies observadas", "Nomes populares ou científicos"),
        ],
      },
    ],
  },
  {
    key: "risco",
    title: "Áreas de risco",
    short: "Risco",
    description: "Tipologia, grau de risco (padrão CPRM), evidências e elementos expostos",
    groups: [
      {
        key: "risco",
        title: "Avaliação de risco",
        fields: [
          {
            key: "tipo",
            label: "Processo",
            multi: true,
            options: o("Escorregamento", "Queda de blocos", "Inundação", "Enxurrada", "Alagamento", "Erosão de margem", "Solapamento", "Subsidência / colapso"),
          },
          { key: "grau", label: "Grau de risco", options: o("R1 baixo", "R2 médio", "R3 alto", "R4 muito alto") },
          {
            key: "evidencias",
            label: "Evidências",
            multi: true,
            options: o("Trincas no solo", "Trincas em moradias", "Árvores / postes inclinados", "Muros embarrigados", "Degraus de abatimento", "Marcas de cheia", "Cortes verticais", "Lançamento de águas servidas"),
          },
          {
            key: "expostos",
            label: "Elementos expostos",
            multi: true,
            options: o("Moradias", "Vias", "Pontes", "Rede elétrica", "Escola / posto de saúde", "Lavouras", "Criações"),
          },
          num("moradias", "Moradias expostas", "un"),
          num("marca_cheia", "Altura da marca de cheia", "m"),
        ],
      },
    ],
  },
  {
    key: "socioambiental",
    title: "Socioambiental",
    short: "Socioambiental",
    description: "Entrevistas, percepção, conflitos e pontos de interesse da comunidade",
    groups: [
      {
        key: "social",
        title: "Registro socioambiental",
        fields: [
          { key: "tipo", label: "Tipo de registro", options: o("Entrevista", "Observação", "Conflito", "Ponto de interesse", "Infraestrutura") },
          {
            key: "grupo",
            label: "Grupo social",
            options: o("Agricultor familiar", "Comunidade tradicional", "Indígena", "Quilombola", "Morador urbano", "Gestor público", "Empresa / produtor"),
          },
          {
            key: "temas",
            label: "Temas",
            multi: true,
            options: o("Água", "Uso do solo", "Desmatamento", "Resíduos", "Saneamento", "Turismo", "Mineração", "Agrotóxicos", "Moradia", "Desastres"),
          },
          { key: "percepcao", label: "Percepção de risco/impacto", options: o("Baixa", "Média", "Alta") },
          { key: "tcle", label: "Consentimento (TCLE)", options: o("Sim", "Não", "Não se aplica") },
          txt("entrevistado", "Entrevistado(a) / código", "Use código se for anônimo"),
        ],
      },
    ],
  },
  {
    key: "verdade_campo",
    title: "Verdade de campo (sensoriamento remoto)",
    short: "Verdade de campo",
    description: "Validação de classificação: classe observada, homogeneidade do pixel, sensor e mudanças",
    groups: [
      {
        key: "vc",
        title: "Validação",
        fields: [
          { key: "classe", label: "Classe observada (MapBiomas)", options: usoMapBiomas },
          { key: "confianca", label: "Confiança", options: o("Alta", "Média", "Baixa") },
          { key: "sensor", label: "Produto / sensor alvo", multi: true, options: o("Sentinel-2 (10 m)", "Landsat (30 m)", "CBERS-4A", "PlanetScope", "Sentinel-1 (SAR)", "Drone / VANT", "MapBiomas") },
          { key: "homogeneidade", label: "Homogeneidade em volta do ponto", options: o("Homogêneo", "Misto <25%", "Misto 25–50%", "Heterogêneo >50%") },
          num("raio", "Raio homogêneo", "m"),
          { key: "mudanca", label: "Mudança recente", options: o("Nenhuma", "Desmatamento", "Queimada", "Colheita / solo exposto", "Construção", "Regeneração", "Inundação") },
          txt("img_ref", "Imagem de referência", "Ex.: S2 2026-10-28, tile 22JBT"),
          { key: "fotos_dir", label: "Fotos direcionais feitas", multi: true, options: o("Norte", "Leste", "Sul", "Oeste", "Zênite") },
        ],
      },
    ],
  },
];

/** All groups, de-duplicated by key (a group can appear in several fichas). */
export const dictionaries: DictGroup[] = Array.from(new Map(fichas.flatMap((f) => f.groups).map((g) => [g.key, g])).values());

/** Turns a user-created ficha (stored in the device / synced) into a Ficha with one group. */
export function customToFicha(c: { key: string; title: string; short: string; description: string; fields: any[] }): Ficha {
  return {
    key: c.key,
    title: c.title,
    short: c.short || c.title,
    description: c.description || "Ficha personalizada",
    groups: [{ key: c.key, title: c.title, fields: c.fields as DictField[] }],
  };
}

/** Human label for an attribute key like "solo.horizonte" or "solo.horizonte.outro". */
export function attrLabel(key: string, extra: Ficha[] = []): string {
  if (key === "_fichas") return "Fichas";
  if (key === "_campanha") return "Campanha";
  const gnss: Record<string, string> = {
    "gnss.leituras": "GNSS · leituras na média",
    "gnss.tempo_s": "GNSS · tempo de ocupação (s)",
    "gnss.dispersao_m": "GNSS · dispersão horizontal (m)",
    "gnss.ondulacao_geoidal_m": "GNSS · ondulação geoidal N, EGM96 (m)",
    "gnss.altitude_ortometrica_m": "GNSS · altitude ortométrica aprox. H (m)",
    "gnss.altitude_mdt_m": "MDT · elevação do modelo no ponto (m)",
  };
  if (gnss[key]) return gnss[key];
  const isOther = key.endsWith(".outro");
  const base = isOther ? key.slice(0, -6) : key;
  const [g, f] = base.split(".");
  const group = dictionaries.find((x) => x.key === g) ?? extra.flatMap((x) => x.groups).find((x) => x.key === g);
  const field = group?.fields.find((x) => x.key === f);
  const label = field ? `${group!.title} · ${field.label}` : base;
  const unit = field && field.type === "number" && field.unit ? ` (${field.unit})` : "";
  return label + unit + (isOther ? " (outro)" : "");
}

/** Which fichas a record uses: the saved list, or the ones its attributes belong to. */
export function fichasOf(attributes: Record<string, string | string[]>, extra: Ficha[] = []): string[] {
  const saved = attributes["_fichas"];
  if (Array.isArray(saved) && saved.length) return saved;
  const groups = new Set(Object.keys(attributes).map((k) => k.split(".")[0]));
  // A shared group (e.g. intemperismo) alone shouldn't pull in every ficha that contains it.
  const own = [...fichas, ...extra].filter((f) => f.groups.some((g) => groups.has(g.key) && g.key !== "intemperismo")).map((f) => f.key);
  if (own.length) return own;
  return groups.has("intemperismo") ? ["geomorfologia"] : [];
}

export const measurementTypes = [
  { value: "dist_borda", label: "Distância até a borda", unit: "m" },
  { value: "profundidade", label: "Profundidade", unit: "m" },
  { value: "largura", label: "Largura", unit: "m" },
  { value: "recuo", label: "Recuo da cabeceira", unit: "m" },
  { value: "inclinacao", label: "Inclinação do talude", unit: "°" },
  { value: "nivel_agua", label: "Nível d'água", unit: "m" },
  { value: "vazao", label: "Vazão", unit: "m³/s" },
  { value: "turbidez", label: "Turbidez", unit: "NTU" },
  { value: "cobertura", label: "Cobertura vegetal", unit: "%" },
  { value: "outro", label: "Outra medida", unit: "" },
];
