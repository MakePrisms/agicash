import { useMemo } from 'react';

type ParsedLine = {
  type:
    | 'paragraph'
    | 'heading1'
    | 'heading2'
    | 'heading3'
    | 'listItem'
    | 'break';
  content: string;
};

type MarkdownProps = {
  content: string;
};

export function Markdown({ content }: MarkdownProps) {
  const parsedContent = useMemo(() => {
    if (!content) return [];

    const lines = content.split('\n');
    const parsed: ParsedLine[] = [];

    lines.forEach((line) => {
      const trimmedLine = line.trim();

      if (trimmedLine === '') {
        parsed.push({ type: 'break', content: '' });
      } else if (trimmedLine.startsWith('# ')) {
        parsed.push({ type: 'heading1', content: trimmedLine.substring(2) });
      } else if (trimmedLine.startsWith('## ')) {
        parsed.push({ type: 'heading2', content: trimmedLine.substring(3) });
      } else if (trimmedLine.startsWith('### ')) {
        parsed.push({ type: 'heading3', content: trimmedLine.substring(4) });
      } else if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ')) {
        parsed.push({ type: 'listItem', content: trimmedLine.substring(2) });
      } else {
        parsed.push({ type: 'paragraph', content: trimmedLine });
      }
    });

    return parsed;
  }, [content]);
  return (
    <div>
      {parsedContent.map((line, index) => {
        const key = index;

        switch (line.type) {
          case 'heading1':
            return (
              <h1
                key={key}
                className="font-bold text-2xl"
                dangerouslySetInnerHTML={{ __html: line.content }}
              />
            );
          case 'heading2':
            return (
              <h2
                key={key}
                className="mt-6 mb-3 font-bold text-xl"
                dangerouslySetInnerHTML={{ __html: line.content }}
              />
            );
          case 'heading3':
            return (
              <h3
                key={key}
                className="mt-4 mb-2 font-bold text-lg"
                dangerouslySetInnerHTML={{ __html: line.content }}
              />
            );
          case 'listItem':
            return (
              <div key={key} className="mb-2 ml-4 flex">
                <span className="mr-2">•</span>
                <span dangerouslySetInnerHTML={{ __html: line.content }} />
              </div>
            );
          case 'paragraph':
            return (
              <p
                key={key}
                className="mb-4"
                dangerouslySetInnerHTML={{ __html: line.content }}
              />
            );
          case 'break':
            return <div key={key} className="h-4" />;
          default:
            return null;
        }
      })}
    </div>
  );
}
