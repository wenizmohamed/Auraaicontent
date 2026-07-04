// Style Packs — curated premium design directions for the Creative Studio.
//
// Modeled on the motionsites.ai pattern (teardown 2026-07-04): their outputs
// look designer-grade because every template is a PRECISION DESIGN CONTRACT —
// exact hex palettes, named texture recipes (noise, liquid-glass), typography
// vibes and lighting specs — never vague "make it beautiful" adjectives.
// Each pack here is that same contract, written for ad/social imagery and
// Veo-formula video instead of landing pages. The directives are injected
// into the prompt enhancer (prompt-enhancer.service.ts) as a hard style
// constraint, and merged into the raw prompt when enhancement is off.
//
// Curation rules: concrete hexes + materials + light, one signature texture
// per pack, and NOTHING that fights the product-hero rule of ad creative.

export interface StylePack {
  id: string;
  name: string;
  tagline: string;
  category: 'editorial' | 'luxe' | 'tech' | 'organic' | 'retro' | 'bold' | 'cultural';
  /** 3–5 hexes; FE renders them as the pack's preview swatch. */
  palette: string[];
  /** Precision style directive for image generation. */
  image: string;
  /** Style & ambiance + motion vocabulary for video generation (Veo formula tail). */
  video: string;
  /** Extra comma-separated negatives merged into the video negativePrompt. */
  negative?: string;
}

export const STYLE_PACKS: StylePack[] = [
  {
    id: 'liquid-glass',
    name: 'Liquid Glass',
    tagline: 'Frosted translucency, Apple-keynote sheen',
    category: 'tech',
    palette: ['#0A0A0C', '#DDE3EA', '#7DD3FC', '#FFFFFF'],
    image: 'Near-black #0A0A0C environment with frosted liquid-glass panels: translucent surfaces at ~4% white opacity, heavy background blur behind them, 1px inner white edge highlight, soft specular streaks. Product sits ON or BEHIND glass, lit by a cool top-left key with icy #7DD3FC accent glow. Pale #DDE3EA sans-serif typography space kept clear. Ultra-clean, no clutter, premium hardware-launch aesthetic.',
    video: 'Style & ambiance: dark #0A0A0C studio, frosted translucent glass panels drifting in parallax with soft specular sweeps, icy blue #7DD3FC rim light on the subject, slow elegant camera glide, pristine highlights, high-end tech-keynote grade.',
    negative: 'grunge, warm tones, clutter, plastic look',
  },
  {
    id: 'warm-cream-editorial',
    name: 'Warm Cream Editorial',
    tagline: 'Black + cream, serif elegance, film grain',
    category: 'editorial',
    palette: ['#000000', '#DEDBC8', '#E1E0CC', '#101010'],
    image: 'Pure black #000000 backdrop, warm cream #DEDBC8 as the ONLY accent color. Moody cinematic single-source lighting with deep soft shadows, subtle 35mm film-grain noise texture across the frame, generous negative space for an italic serif headline in cream. Dark, expensive, gallery-catalog composition; product hero-lit dead center or on a thirds line.',
    video: 'Style & ambiance: moody black #000000 world with warm cream #DEDBC8 highlights, cinematic single key light, gentle film-grain texture, slow contemplative dolly, editorial fashion-film grade with deep blacks.',
    negative: 'bright colors, daylight, busy background',
  },
  {
    id: 'dreamcore',
    name: 'Dreamcore',
    tagline: 'Surreal pastel fog, ethereal glow',
    category: 'organic',
    palette: ['#E9D5FF', '#BFDBFE', '#FBCFE8', '#F5F3FF'],
    image: 'Surreal dreamscape: pastel lavender #E9D5FF and baby-blue #BFDBFE fog rolling across an infinite plane, soft pink #FBCFE8 horizon glow, floating soft-focus orbs, product emerging crisp and sharp from the haze as the only hyper-real element. Diffused omnidirectional light, zero hard shadows, ethereal and weightless.',
    video: 'Style & ambiance: pastel dream-fog world in lavender and baby blue, slow drifting mist, floating bokeh orbs, the subject tack-sharp against the ethereal haze, weightless slow-motion feel, soft diffused glow grade.',
    negative: 'harsh shadows, saturated primary colors, gritty texture',
  },
  {
    id: 'cinematic-space',
    name: 'Cinematic Space',
    tagline: 'Nebula glow, deep-space scale',
    category: 'tech',
    palette: ['#020208', '#4C1D95', '#38BDF8', '#F8FAFC'],
    image: 'Deep-space setting: #020208 void with a violet #4C1D95 nebula bloom and cold starlight, product monumental in frame like a spacecraft reveal, lit by a single #38BDF8 blue-white rim light with an anamorphic lens-flare streak. Vast scale, low camera angle, cinematic letterbox energy, crisp white #F8FAFC accents.',
    video: 'Style & ambiance: deep-space void with violet nebula glow and drifting starfields, monumental slow orbital camera move around the subject, anamorphic flares, blue-white rim lighting, epic trailer grade.',
    negative: 'cartoon planets, daylight, small-scale tabletop look',
  },
  {
    id: 'retro-futurist',
    name: 'Retro Futurist',
    tagline: 'Chrome, sunset grids, 80s optimism',
    category: 'retro',
    palette: ['#F97316', '#EC4899', '#1E1B4B', '#FDE68A'],
    image: 'Retro-futurist 1980s poster: sunset gradient sky from hot orange #F97316 through pink #EC4899 into indigo #1E1B4B, glowing horizon grid receding to a vanishing point, product rendered with chrome reflections catching the sunset, subtle VHS scanline texture, bold geometric composition with warm #FDE68A glow accents.',
    video: 'Style & ambiance: 80s retro-future sunset world, orange-to-pink gradient sky over a glowing wireframe grid, chrome reflections sweeping across the subject, slow low-angle push-in, subtle VHS texture, synthwave grade.',
    negative: 'modern minimalism, muted colors, photorealistic office',
  },
  {
    id: 'mythic-naturecore',
    name: 'Mythic Naturecore',
    tagline: 'Lush botanics, god rays, dew',
    category: 'organic',
    palette: ['#14532D', '#84CC16', '#FEF9C3', '#052E16'],
    image: 'Enchanted forest clearing: deep green #14532D foliage walls with backlit #84CC16 leaf edges, volumetric god rays breaking through canopy onto the product, macro dew droplets glistening, soft warm #FEF9C3 light pools. Product placed on natural stone or moss, mythic and untouched, shallow depth of field.',
    video: 'Style & ambiance: lush enchanted forest, volumetric god rays through canopy, dew and drifting pollen catching light, slow reveal push through foliage to the hero subject, nature-documentary richness with a mythic warm grade.',
    negative: 'artificial studio look, neon, urban elements',
  },
  {
    id: 'luxury-noir',
    name: 'Luxury Noir',
    tagline: 'Black marble, gold rim light',
    category: 'luxe',
    palette: ['#09090B', '#D4AF37', '#27272A', '#FAFAF9'],
    image: 'Ultra-luxury still life: polished black marble surface with subtle veining, #09090B charcoal atmosphere, product carved out of darkness by a precise gold #D4AF37 rim light and one soft overhead key. Faint smoke wisps, mirror reflection under the product, gold foil accent details. Restraint, symmetry, watch-advert precision.',
    video: 'Style & ambiance: black marble and darkness, a single gold rim light tracing the subject silhouette, slow macro slider move with smoke wisps, mirror reflections, opulent watch-commercial grade.',
    negative: 'bright daylight, plastic, casual setting, clutter',
  },
  {
    id: 'urban-jungle',
    name: 'Urban Jungle',
    tagline: 'Concrete + palms, hard sun',
    category: 'bold',
    palette: ['#A8A29E', '#166534', '#FACC15', '#292524'],
    image: 'Brutalist concrete architecture washed in hard midday sun, monstera and palm shadows cast sharp across raw #A8A29E concrete walls, product staged on a concrete plinth, deep green #166534 foliage bursting from frame edges, one punchy #FACC15 yellow accent. High contrast, editorial street-style attitude.',
    video: 'Style & ambiance: raw concrete cityscape with hard sunlight and sharp palm-leaf shadows sweeping across surfaces, confident handheld-style micro movement, high-contrast punchy grade with deep green accents.',
    negative: 'soft pastel, fog, night scene',
  },
  {
    id: 'gradient-pop',
    name: 'Gradient Pop 3D',
    tagline: 'Glossy 3D shapes, candy gradients',
    category: 'bold',
    palette: ['#8B5CF6', '#EC4899', '#06B6D4', '#FDE047'],
    image: 'Vivid 3D-render world: smooth candy-gradient background flowing violet #8B5CF6 to pink #EC4899 to cyan #06B6D4, glossy inflated 3D shapes and soft blobs floating around the hero product, clean studio reflections, toy-like tactile materials, bold #FDE047 accent pops. Playful, hyper-clean, app-store-feature energy.',
    video: 'Style & ambiance: candy-gradient 3D world, glossy floating shapes bobbing in slow zero-gravity around the subject, smooth orbit camera, bright clean studio reflections, playful premium 3D-render grade.',
    negative: 'photorealistic grit, dark moody lighting, texture noise',
  },
  {
    id: 'brutalist-mono',
    name: 'Brutalist Mono',
    tagline: 'Stark B/W, giant type energy',
    category: 'editorial',
    palette: ['#000000', '#FFFFFF', '#EF4444'],
    image: 'Stark monochrome composition: pure white #FFFFFF field, product in crisp black-and-white with brutal hard-edged shadow, massive negative space engineered for an oversized black sans-serif headline, exactly ONE element allowed in red #EF4444. Swiss-poster grid discipline, zero decoration, maximum confidence.',
    video: 'Style & ambiance: stark black-and-white world with one red accent, hard single-source shadow, locked-off camera with a single decisive move, Swiss-poster minimalism, high-contrast mono grade.',
    negative: 'gradients, warm tones, decorative elements, soft light',
  },
  {
    id: 'soft-clay',
    name: 'Soft Clay',
    tagline: 'Matte 3D clay, pastel studio',
    category: 'organic',
    palette: ['#FDA4AF', '#FED7AA', '#A7F3D0', '#F5F5F4'],
    image: 'Claymorphism studio: matte hand-sculpted clay world in pastel pink #FDA4AF, peach #FED7AA and mint #A7F3D0, rounded chunky forms with soft fingerprint-like imperfections, product presented on a clay pedestal, big soft top light with gentle ambient occlusion in the creases. Friendly, tactile, stop-motion charm.',
    video: 'Style & ambiance: pastel clay stop-motion world, chunky matte forms with soft shadows, gentle bouncy motion rhythm, warm soft top light, playful handcrafted charm grade.',
    negative: 'glossy surfaces, photorealism, dark tones',
  },
  {
    id: 'desert-modern',
    name: 'Desert Modern',
    tagline: 'Sand, terracotta, Gulf minimalism',
    category: 'cultural',
    palette: ['#E7D8C9', '#C2410C', '#78350F', '#FFF7ED'],
    image: 'Modern Gulf minimalism: smooth sand-plaster architecture in warm beige #E7D8C9, a terracotta #C2410C arched alcove framing the product, late-afternoon desert sun casting long soft-edged shadows, fine sand texture in foreground, clean #FFF7ED sky. Serene, spacious, five-star-resort restraint with regional soul.',
    video: 'Style & ambiance: sun-washed desert-modern architecture with arched alcoves, long golden-hour shadows crawling across sand-plaster walls, slow reverent camera drift, warm serene resort-film grade.',
    negative: 'snow, neon, cluttered market scene',
  },
  {
    id: 'ramadan-gold',
    name: 'Ramadan Gold',
    tagline: 'Midnight blue, lantern glow, crescent bokeh',
    category: 'cultural',
    palette: ['#1E3A8A', '#D4AF37', '#0F172A', '#FEF3C7'],
    image: 'Ramadan night scene: deep midnight-blue #1E3A8A to #0F172A gradient sky, warm gold #D4AF37 lantern (fanous) glow illuminating the product, crescent-moon and star bokeh floating softly in the background, delicate golden geometric Islamic pattern vignetting the corners, warm #FEF3C7 candlelight fill. Festive, warm, family-hour serenity.',
    video: 'Style & ambiance: midnight-blue Ramadan night with warm golden lantern light flickering on the subject, crescent bokeh drifting, gentle celebratory slow push-in, ornamental gold pattern accents, warm festive grade.',
    negative: 'daylight, cold tones, western holiday elements',
  },
  {
    id: 'neo-arabic-editorial',
    name: 'Neo-Arabic Editorial',
    tagline: 'Ivory + emerald, calligraphy accents',
    category: 'cultural',
    palette: ['#FFFBEB', '#065F46', '#B45309', '#1C1917'],
    image: 'Contemporary Arabic editorial: ivory #FFFBEB backdrop with a bold emerald #065F46 color block, product staged gallery-style with soft directional light, abstract flowing Arabic-calligraphy brushstroke in bronze #B45309 as a single background art element, generous margins engineered for elegant Arabic + Latin dual typography.',
    video: 'Style & ambiance: ivory gallery space with emerald color blocks and a flowing bronze calligraphic stroke, poised museum-like camera moves, soft directional light, refined contemporary-khaleeji editorial grade.',
    negative: 'busy ornament, cliché desert props, low-contrast beige-on-beige',
  },
];

const BY_ID = new Map(STYLE_PACKS.map((p) => [p.id, p]));

export function getStylePack(id?: string | null): StylePack | undefined {
  if (!id) return undefined;
  return BY_ID.get(id);
}

/** Listing shape for the FE picker — directives stay server-side. */
export function listStylePacks() {
  return STYLE_PACKS.map(({ id, name, tagline, category, palette }) => ({ id, name, tagline, category, palette }));
}
