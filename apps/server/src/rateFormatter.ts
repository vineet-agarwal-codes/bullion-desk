export interface RateQuoteItem {
  name: string;
  metal: 'GOLD' | 'SILVER';
  settlement: 'RTGS' | 'CASH';
  gstPercent: number;
  buyRate: number;
  sellRate: number;
}

export interface FormatRatesOptions {
  header: string;
  tick?: { goldMcx: number; silverMcx: number };
  metal?: 'GOLD' | 'SILVER';
  settlement?: 'RTGS' | 'CASH';
  markdown?: boolean;
}

function formatQuoteLine(q: RateQuoteItem, markdown: boolean): string {
  const gstTag = q.gstPercent > 0 ? ` (+${q.gstPercent}% GST)` : '';
  const label = markdown ? `*${q.name}${gstTag}*` : `${q.name}${gstTag}`;
  return `• ${label}: Buy ₹${q.buyRate.toLocaleString('en-IN')} | Sell ₹${q.sellRate.toLocaleString('en-IN')}`;
}

export function formatBullionRatesMessage(
  quotes: RateQuoteItem[],
  options: FormatRatesOptions
): string {
  const md = options.markdown ?? true;
  const b = (text: string) => (md ? `*${text}*` : text);
  const em = (text: string) => (md ? `_${text}_` : text);

  const goldQuotes = quotes.filter((q) => q.metal === 'GOLD');
  const silverQuotes = quotes.filter((q) => q.metal === 'SILVER');

  const sections: string[] = [];

  if (goldQuotes.length > 0) {
    const header = options.metal ? '' : `${b('GOLD (10g)')}\n`;
    sections.push(`${header}${goldQuotes.map((q) => formatQuoteLine(q, md)).join('\n')}`);
  }

  if (silverQuotes.length > 0) {
    const header = options.metal ? '' : `${b('SILVER (1kg / 30kg Peti)')}\n`;
    sections.push(`${header}${silverQuotes.map((q) => formatQuoteLine(q, md)).join('\n')}`);
  }

  if (sections.length === 0) {
    sections.push('No active scrips match that filter.');
  }

  const mcxLine = options.tick
    ? `MCX Gold: ₹${options.tick.goldMcx.toLocaleString('en-IN')} | MCX Silver: ₹${options.tick.silverMcx.toLocaleString('en-IN')}\n\n`
    : '\n';

  const footer =
    `\n\n${em('Note: RTGS rates attract +3% GST; Cash / Badla has 0% GST.')}\n` +
    `${em('Ask for "gold rate", "silver rate", "cash" or "rtgs" for specifics, or say "2 peti chandi pakki kar do" to book.')}`;

  return `${options.header}\n${mcxLine}${sections.join('\n\n')}${footer}`;
}
