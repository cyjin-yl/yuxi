import os
import subprocess
import re

input_dir = "/home/ezra/english_songs/output"
output_dir = "/home/ezra/yuxi/src/content/songs"

for fname in sorted(os.listdir(input_dir)):
    if not fname.endswith(".docx") or "Vocab" in fname:
        continue
    
    fpath = os.path.join(input_dir, fname)
    
    # Extract text using pandoc or python-docx
    try:
        result = subprocess.run(["pandoc", "-f", "docx", "-t", "plain", fpath], capture_output=True, text=True)
        text = result.stdout
    except:
        try:
            result = subprocess.run(["python3", "-c", f"from docx import Document; d=Document('{fpath}'); print('\\n'.join(p.text for p in d.paragraphs))"], capture_output=True, text=True)
            text = result.stdout
        except:
            print(f"Failed to parse {fname}")
            continue
    
    lines = text.strip().split('\n')
    
    # Parse metadata
    song_num = ""
    song_en = ""
    song_cn = ""
    vocab_count = ""
    words = []
    current_word = {}
    
    for i, line in enumerate(lines):
        line = line.strip()
        if not line:
            continue
        
        # 第X首
        if line.startswith("第") and "首" in line:
            song_num = line
        
        # 英文歌名
        if re.match(r'^[A-Z][A-Za-z\s\.\'\-]+$', line) and len(line) > 5 and song_en == "":
            song_en = line
            
        # 中文歌名
        elif re.match(r'^[\u4e00-\u9fff]+$', line) and len(line) >= 3 and song_cn == "":
            song_cn = line
            
        # 生词数量
        elif "生词数量" in line:
            vocab_count = line
            
        # 表头跳过
        elif line in ["单词", "音标", "中文意思", "例句"]:
            if current_word and "word" in current_word:
                words.append(current_word)
            current_word = {}
            if line == "单词":
                pass
    
    # Second pass: parse words properly
    words = []
    current_word = {}
    field = 0
    for line in lines:
        line = line.strip()
        if not line or line.startswith("第") or "生词数量" in line:
            continue
        
        # Detect word line (alphabetic)
        if re.match(r'^[a-z]', line) and field == 0:
            if current_word and "word" in current_word:
                words.append(current_word)
            current_word = {"word": line}
            field = 1
        # Phonetics /.../
        elif line.startswith("/") and field == 1:
            current_word["phonetic"] = line
            field = 2
        # Chinese meaning
        elif field == 2 and not line.startswith("/"):
            current_word["meaning"] = line
            field = 3
        # Example sentence
        elif field == 3 and re.match(r'^[A-Z]', line):
            current_word["example"] = line
            field = 0
            words.append(current_word)
            current_word = {}
    
    if current_word and "word" in current_word:
        words.append(current_word)
    
    # Build markdown
    md = f"---\ntitle: \"第{song_num}首 - {song_en}\"\n\n---\n\n"
    md += f"# {song_en}\n\n"
    if song_cn:
        md += f"**{song_cn}**\n\n"
    if vocab_count:
        md += f"{vocab_count}\n\n"
    
    md += "## 生词表\n\n"
    md += "| 单词 | 音标 | 中文意思 | 例句 |\n"
    md += "|------|------|----------|------|\n"
    for w in words:
        word = w.get("word", "")
        phonetic = w.get("phonetic", "")
        meaning = w.get("meaning", "")
        example = w.get("example", "")
        md += f"| {word} | {phonetic} | {meaning} | {example} |\n"
    
    # Write to output
    stem = os.path.splitext(fname)[0]
    # Use safe slug: first few words of song name
    slug = song_en.lower().replace(" ", "-").replace("'", "").replace(".", "")[:30]
    out_path = os.path.join(output_dir, f"{slug}.md")
    
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(md)
    
    print(f"Converted {fname} -> {slug}.md ({len(words)} words)")

print("Done!")
