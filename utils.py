def allowed_file(filename, allowed_extensions):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in allowed_extensions

def read_file_content(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        return f.read()