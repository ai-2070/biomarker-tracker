// Finding the files a chat message mentions.
import { describe, expect, it } from 'vitest';
import { findFileMentions } from '../../web/mentions.ts';

describe('findFileMentions()', () => {
  it('finds Windows and Mac/Linux paths', () => {
    expect(findFileMentions('Saved to C:\\Users\\me\\Videos\\out.mp4 and C:/renders/shot.png.')).toEqual(['C:\\Users\\me\\Videos\\out.mp4', 'C:/renders/shot.png']);
    expect(findFileMentions('Wrote /Users/me/project/notes/plan.md, then /tmp/a.png')).toEqual(['/Users/me/project/notes/plan.md', '/tmp/a.png']);
  });

  it('takes quoted and backticked paths with spaces whole', () => {
    expect(findFileMentions('Open `C:\\My Files\\final cut.mov` now')).toEqual(['C:\\My Files\\final cut.mov']);
    expect(findFileMentions('It is at "/Users/me/My Videos/clip 2.webm".')).toEqual(['/Users/me/My Videos/clip 2.webm']);
  });

  it('reads markdown links and file:// links', () => {
    expect(findFileMentions('![render](/srv/out/render.png) and [doc](<C:\\a b\\doc.pdf>)')).toEqual(['/srv/out/render.png', 'C:\\a b\\doc.pdf']);
    expect(findFileMentions('see file:///C:/Users/me/My%20Pics/a.jpg and file:///home/me/b.gif')).toEqual(['C:/Users/me/My Pics/a.jpg', '/home/me/b.gif']);
  });

  it('web links and relative paths are not files', () => {
    expect(findFileMentions('https://example.com/img/a.png and //cdn.x/b.png and src/app.ts and ./x.png')).toEqual([]);
  });

  it('needs an extension, and drops trailing punctuation', () => {
    expect(findFileMentions('the folder /Users/me/project is ready')).toEqual([]);
    expect(findFileMentions('Done: /tmp/out.png!')).toEqual(['/tmp/out.png']);
  });

  it('each path once, at most max', () => {
    expect(findFileMentions('/a/x.png /a/x.png `/a/x.png`')).toEqual(['/a/x.png']);
    expect(findFileMentions(Array.from({ length: 20 }, (_, i) => `/f/${i}.txt`).join(' '), 5)).toHaveLength(5);
  });

  it('nothing in, nothing out', () => {
    expect(findFileMentions('')).toEqual([]);
    expect(findFileMentions(null)).toEqual([]);
  });

  it('a name with dots keeps its whole extension', () => {
    expect(findFileMentions('Packed /out/archive.tar.gz and C:\\out\\data.2024.zip')).toEqual(['/out/archive.tar.gz', 'C:\\out\\data.2024.zip']);
  });

  it('two different paths that end the same are both kept', () => {
    expect(findFileMentions('/archive/project/shared/x.png and /project/shared/x.png')).toEqual(['/archive/project/shared/x.png', '/project/shared/x.png']);
  });

  it('Mac/Linux paths differ by case; Windows paths do not', () => {
    expect(findFileMentions('/w/A.png and /w/a.png')).toEqual(['/w/A.png', '/w/a.png']);
    expect(findFileMentions('C:\\w\\A.png and c:/w/a.png')).toEqual(['C:\\w\\A.png']);
  });
});
