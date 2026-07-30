/**
 * Studio content generation over the internal `batchexecute` RPC API.
 *
 * One RPC (`CREATE_STUDIO`) creates every artifact type via a type code + a
 * type-specific options blob placed at a fixed index of the `content` array;
 * `POLL_STUDIO` reports status and, when ready, the media URL / text content.
 * Payloads + offsets verified against the reference impl (interop facts).
 */

import { BatchExecuteClient } from './batchexecute.js';

export type StudioType =
  | 'audio_overview'
  | 'report'
  | 'video'
  | 'infographic'
  | 'presentation'
  | 'data_table';

// type code + the `content`-array index its options blob sits at.
const TYPE_META: Record<StudioType, { code: number; optionIndex: number }> = {
  audio_overview: { code: 1, optionIndex: 6 },
  report: { code: 2, optionIndex: 7 },
  video: { code: 3, optionIndex: 8 },
  infographic: { code: 7, optionIndex: 14 },
  presentation: { code: 8, optionIndex: 16 }, // slide deck
  data_table: { code: 9, optionIndex: 18 },
};

export interface StudioArtifact {
  id: string;
  typeCode: number;
  title: string;
  status: 'in_progress' | 'completed' | 'failed' | 'unknown';
  mediaUrl?: string;
  textContent?: string;
}

export interface GenerateResult {
  artifactId: string | null;
  status: string;
  title?: string;
  mediaUrl?: string;
  textContent?: string;
}

export class StudioRpc {
  constructor(private readonly client: BatchExecuteClient) {}

  /** Build the sparse `content` array: [null,null,type,sources,…,options]. */
  private buildContent(type: StudioType, sourcesNested: unknown, options: unknown): unknown[] {
    const { code, optionIndex } = TYPE_META[type];
    const content: unknown[] = new Array(optionIndex + 1).fill(null);
    content[2] = code;
    content[3] = sourcesNested;
    content[optionIndex] = options;
    return content;
  }

  private optionsFor(
    type: StudioType,
    sourcesSimple: unknown,
    lang: string,
    focus: string
  ): unknown {
    switch (type) {
      case 'audio_overview':
        // [null, [focus, length=2, null, sources, lang, null, format=1]]
        return [null, [focus || '', 2, null, sourcesSimple, lang, null, 1]];
      case 'video': {
        // video_options = [null, null, inner]; inner explainer(1) appends style=1
        const inner: unknown[] = [sourcesSimple, lang, focus || '', null, 1, 1];
        return [null, null, inner];
      }
      case 'report':
        // [null, [title, desc, null, sources, lang, prompt, null, true]]
        return [
          null,
          [
            'Briefing Doc',
            'Overview of your sources, with key facts and citations',
            null,
            sourcesSimple,
            lang,
            focus || 'Create a comprehensive briefing document based on the provided sources.',
            null,
            true,
          ],
        ];
      case 'infographic':
        // [[focus, lang, null, orientation=1, detail=2, style=1]]
        return [[focus || null, lang, null, 1, 2, 1]];
      case 'presentation':
        // [[focus, lang, format=1, length=3]]
        return [[focus || null, lang, 1, 3]];
      case 'data_table':
        // [null, [description, lang]]
        return [null, [focus || '', lang]];
    }
  }

  /** Trigger creation. Returns the new artifact id + initial status. */
  async create(
    notebookId: string,
    type: StudioType,
    sourceIds: string[],
    opts: { language?: string; focus?: string } = {}
  ): Promise<{ artifactId: string | null; status: string }> {
    const lang = opts.language || 'en';
    const focus = opts.focus || '';
    const sourcesNested = sourceIds.map((id) => [[id]]);
    const sourcesSimple = sourceIds.map((id) => [id]);
    const options = this.optionsFor(type, sourcesSimple, lang, focus);
    const content = this.buildContent(type, sourcesNested, options);
    const params = [[2], notebookId, content];

    const result = (await this.client.call(
      'CREATE_STUDIO',
      params,
      `/notebook/${notebookId}`
    )) as unknown;
    const artifact = Array.isArray(result) ? (result[0] as unknown) : undefined;
    const artifactId =
      Array.isArray(artifact) && typeof artifact[0] === 'string' ? artifact[0] : null;
    return { artifactId, status: normalizeStatus(artifact) };
  }

  /** Poll all Studio artifacts (id, type, status, title, media/text when ready). */
  async poll(notebookId: string): Promise<StudioArtifact[]> {
    const params = [[2], notebookId, 'NOT artifact.status = "ARTIFACT_STATUS_SUGGESTED"'];
    const result = (await this.client.call(
      'POLL_STUDIO',
      params,
      `/notebook/${notebookId}`
    )) as unknown;
    const list = Array.isArray((result as unknown[])?.[0])
      ? ((result as unknown[])[0] as unknown[])
      : Array.isArray(result)
        ? (result as unknown[])
        : [];
    const out: StudioArtifact[] = [];
    for (const a of list) {
      if (!Array.isArray(a) || a.length < 5) continue;
      const id = typeof a[0] === 'string' ? a[0] : '';
      if (!id) continue;
      const typeCode = typeof a[2] === 'number' ? a[2] : -1;
      out.push({
        id,
        typeCode,
        title: typeof a[1] === 'string' ? a[1] : '',
        status: normalizeStatus(a),
        mediaUrl: extractMediaUrl(a, typeCode),
        textContent: extractTextContent(a, typeCode),
      });
    }
    return out;
  }

  /**
   * Create then poll until the new artifact is completed/failed (or timeout).
   * Returns the artifact with its media URL / text content when ready.
   */
  async generate(
    notebookId: string,
    type: StudioType,
    sourceIds: string[],
    opts: { language?: string; focus?: string; timeoutMs?: number; pollMs?: number } = {}
  ): Promise<GenerateResult> {
    const { artifactId, status } = await this.create(notebookId, type, sourceIds, opts);
    if (status === 'completed' || status === 'failed') {
      return { artifactId, status };
    }
    const deadline = Date.now() + (opts.timeoutMs ?? 900000);
    const pollMs = opts.pollMs ?? 5000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollMs));
      const artifacts = await this.poll(notebookId);
      const mine = artifactId
        ? artifacts.find((a) => a.id === artifactId)
        : artifacts.find((a) => a.typeCode === TYPE_META[type].code);
      if (mine && (mine.status === 'completed' || mine.status === 'failed')) {
        return {
          artifactId: mine.id,
          status: mine.status,
          title: mine.title,
          mediaUrl: mine.mediaUrl,
          textContent: mine.textContent,
        };
      }
    }
    return { artifactId, status: 'timeout' };
  }
}

/** Status code at artifact[4]: 1=in_progress, 3=completed, 4=failed; audio 2+media=completed. */
function normalizeStatus(a: unknown): StudioArtifact['status'] {
  if (!Array.isArray(a) || a.length <= 4) return 'unknown';
  const code = a[4];
  if (code === 1) return 'in_progress';
  if (code === 3) return 'completed';
  if (code === 4) return 'failed';
  if (code === 2 && a[2] === 1 && extractAudioUrl(a)) return 'completed';
  return 'unknown';
}

function extractMediaUrl(a: unknown[], typeCode: number): string | undefined {
  if (typeCode === 1) return extractAudioUrl(a) ?? undefined;
  if (typeCode === 3 && Array.isArray(a[8]) && typeof (a[8] as unknown[])[3] === 'string') {
    return (a[8] as unknown[])[3] as string;
  }
  if (typeCode === 7 && Array.isArray(a[14])) {
    // [14][2][0][1][0]
    const img = ((((a[14] as unknown[])[2] as unknown[])?.[0] as unknown[])?.[1] as unknown[])?.[0];
    if (typeof img === 'string' && img.startsWith('http')) return img;
  }
  if (typeCode === 8 && Array.isArray(a[16])) {
    const o = a[16] as unknown[];
    if (typeof o[0] === 'string' && o[0].startsWith('http')) return o[0];
    if (typeof o[3] === 'string') return o[3];
  }
  return undefined;
}

function extractTextContent(a: unknown[], typeCode: number): string | undefined {
  if (typeCode === 2 && Array.isArray(a[7])) {
    const content = (a[7] as unknown[])[1];
    if (Array.isArray(content) && typeof content[0] === 'string') return content[0];
  }
  return undefined;
}

/** Audio URL at artifact[6][5]: prefer the `-dv` audio/mp4 CDN variant. */
function extractAudioUrl(a: unknown): string | null {
  if (!Array.isArray(a) || a.length <= 6) return null;
  const audioOptions = a[6];
  if (!Array.isArray(audioOptions)) return null;
  const media = audioOptions[5];
  if (Array.isArray(media)) {
    const isHttp = (it: unknown): it is unknown[] =>
      Array.isArray(it) && typeof it[0] === 'string' && (it[0] as string).startsWith('http');
    for (const it of media)
      if (isHttp(it) && it[2] === 'audio/mp4' && (it[0] as string).endsWith('-dv'))
        return it[0] as string;
    for (const it of media) if (isHttp(it) && it[2] === 'audio/mp4') return it[0] as string;
    for (const it of media) if (isHttp(it)) return it[0] as string;
  }
  if (typeof audioOptions[3] === 'string') return audioOptions[3];
  return null;
}
