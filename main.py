import tkinter as tk
from tkinter import filedialog, messagebox, scrolledtext
import os
from validator import validate_ads_txt

# Importujemy tkinterdnd2 dla obsługi drag & drop
from tkinterdnd2 import TkinterDnD, DND_FILES

class AdsTxtValidatorApp(TkinterDnD.Tk):
    def __init__(self):
        super().__init__()
        self.title("app-ads.txt Validator")
        self.geometry("1000x750")
        self.corrected_content = ""  # Przechowuje poprawioną treść
        self.create_menu()
        self.create_widgets()

    def create_menu(self):
        # Menu bar z opcjami File oraz Help
        menubar = tk.Menu(self)
        file_menu = tk.Menu(menubar, tearoff=0)
        file_menu.add_command(label="Open", command=self.open_file)
        file_menu.add_command(label="Save", command=self.save_file)
        file_menu.add_separator()
        file_menu.add_command(label="Clear", command=self.clear_all)
        file_menu.add_separator()
        file_menu.add_command(label="Exit", command=self.quit)
        menubar.add_cascade(label="File", menu=file_menu)

        help_menu = tk.Menu(menubar, tearoff=0)
        help_menu.add_command(label="About", command=self.show_about)
        menubar.add_cascade(label="Help", menu=help_menu)
        self.config(menu=menubar)

    def create_widgets(self):
        # Ramka z przyciskami
        button_frame = tk.Frame(self)
        button_frame.pack(pady=10)
        btn_validate = tk.Button(button_frame, text="Validate and Correct", command=self.validate_content)
        btn_validate.grid(row=0, column=0, padx=5)
        btn_copy = tk.Button(button_frame, text="Copy to Clipboard", command=self.copy_to_clipboard)
        btn_copy.grid(row=0, column=1, padx=5)

        # Ramka dla pola tekstowego z numeracją linii
        input_frame = tk.Frame(self)
        input_frame.pack(padx=10, pady=5, fill=tk.BOTH, expand=True)
        # Canvas z numerami linii
        self.linenumbers = tk.Canvas(input_frame, width=40, bg="#2e2e2e")
        self.linenumbers.pack(side=tk.LEFT, fill=tk.Y)
        # Pole tekstowe z oryginalną treścią – dodajemy obsługę drag&drop
        self.text_input = scrolledtext.ScrolledText(input_frame, wrap=tk.WORD, width=80, height=10)
        self.text_input.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        self.text_input.bind("<KeyRelease>", self.update_line_numbers)
        self.text_input.bind("<MouseWheel>", self.update_line_numbers)
        self.text_input.bind("<Button-1>", self.update_line_numbers)
        self.text_input.drop_target_register(DND_FILES)
        self.text_input.dnd_bind("<<Drop>>", self.drop_inside)

        lbl_input = tk.Label(self, text="Input app-ads.txt Content (with line numbers):")
        lbl_input.pack(anchor="w", padx=10)

        # Pole tekstowe z poprawioną treścią
        lbl_output = tk.Label(self, text="Corrected Content:")
        lbl_output.pack(anchor="w", padx=10)
        self.text_output = scrolledtext.ScrolledText(self, wrap=tk.WORD, width=100, height=10)
        self.text_output.pack(padx=10, pady=5)

        # Pole tekstowe z notatkami
        lbl_notes = tk.Label(self, text="Notes:")
        lbl_notes.pack(anchor="w", padx=10)
        self.text_notes = scrolledtext.ScrolledText(self, wrap=tk.WORD, width=100, height=5)
        self.text_notes.pack(padx=10, pady=5)

        # Pasek stanu
        self.status_bar = tk.Label(self, text="Ready", bd=1, relief=tk.SUNKEN, anchor="w")
        self.status_bar.pack(side=tk.BOTTOM, fill=tk.X)

        # Inicjalne uaktualnienie numerów linii
        self.update_line_numbers()

    def update_line_numbers(self, event=None):
        """Aktualizuje numerację linii obok pola tekstowego z oryginalną treścią."""
        self.linenumbers.delete("all")
        i = self.text_input.index("@0,0")
        while True:
            dline = self.text_input.dlineinfo(i)
            if dline is None:
                break
            y = dline[1]
            linenum = str(i).split(".")[0]
            self.linenumbers.create_text(2, y, anchor="nw", text=linenum, font=("Consolas", 10))
            i = self.text_input.index(f"{i}+1line")

    def drop_inside(self, event):
        """Obsługa przeciągnięcia pliku do pola tekstowego."""
        files = self.tk.splitlist(event.data)
        if files:
            file_path = files[0]
            # Usuń klamry, jeśli występują
            if file_path.startswith("{") and file_path.endswith("}"):
                file_path = file_path[1:-1]
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                self.text_input.delete("1.0", tk.END)
                self.text_input.insert(tk.END, content)
                self.update_line_numbers()
                self.set_status(f"Loaded file: {os.path.basename(file_path)} via drag-and-drop")
            except Exception as e:
                messagebox.showerror("Error", f"Failed to load dropped file: {str(e)}")

    def open_file(self):
        file_path = filedialog.askopenfilename(
            title="Open app-ads.txt File", 
            filetypes=[("Text Files", "*.txt")]
        )
        if file_path:
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                self.text_input.delete("1.0", tk.END)
                self.text_input.insert(tk.END, content)
                self.update_line_numbers()
                self.set_status(f"Loaded file: {os.path.basename(file_path)}")
            except Exception as e:
                messagebox.showerror("Error", f"Failed to read file: {str(e)}")
                self.set_status("Error loading file")

    def validate_content(self):
        content = self.text_input.get("1.0", tk.END).strip()
        if not content:
            messagebox.showwarning("Warning", "No content provided!")
            self.set_status("Validation failed: No content")
            return
        corrected, notes = validate_ads_txt(content)
        self.corrected_content = corrected
        self.text_output.delete("1.0", tk.END)
        self.text_output.insert(tk.END, corrected)
        self.text_notes.delete("1.0", tk.END)
        self.text_notes.insert(tk.END, "\n".join(notes))
        messagebox.showinfo("Info", "Validation completed.")
        self.set_status("Validation completed successfully")

    def copy_to_clipboard(self):
        if self.corrected_content:
            self.clipboard_clear()
            self.clipboard_append(self.corrected_content)
            messagebox.showinfo("Info", "Corrected content copied to clipboard!")
            self.set_status("Copied to clipboard")
        else:
            messagebox.showwarning("Warning", "No corrected content to copy!")
            self.set_status("Nothing to copy")

    def save_file(self):
        if self.corrected_content:
            file_path = filedialog.asksaveasfilename(
                title="Save Corrected File", 
                defaultextension=".txt", 
                filetypes=[("Text Files", "*.txt")]
            )
            if file_path:
                try:
                    with open(file_path, 'w', encoding='utf-8') as f:
                        f.write(self.corrected_content)
                    messagebox.showinfo("Info", "File saved successfully!")
                    self.set_status(f"File saved: {os.path.basename(file_path)}")
                except Exception as e:
                    messagebox.showerror("Error", f"Failed to save file: {str(e)}")
                    self.set_status("Error saving file")
        else:
            messagebox.showwarning("Warning", "No corrected content to save!")
            self.set_status("Nothing to save")

    def clear_all(self):
        self.text_input.delete("1.0", tk.END)
        self.text_output.delete("1.0", tk.END)
        self.text_notes.delete("1.0", tk.END)
        self.corrected_content = ""
        self.update_line_numbers()
        self.set_status("Cleared all fields")

    def show_about(self):
        messagebox.showinfo("About", "app-ads.txt Validator\nVersion 0.1.0\nDeveloped by Your Name")

    def set_status(self, text):
        self.status_bar.config(text=text)

if __name__ == "__main__":
    app = AdsTxtValidatorApp()
    app.mainloop()