using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Speech.Recognition;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("Pisa-nina — заметки")]
[assembly: AssemblyDescription("Лёгкое приложение для заметок")]
[assembly: AssemblyProduct("Pisa-nina")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]
namespace PoliaNotes
{
    public class CategoryModel
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string Color { get; set; }
        public string OwnerFolderId { get; set; }
        public string ParentCategoryId { get; set; }
        public long CreatedAt { get; set; }
        public long UpdatedAt { get; set; }
    }

    public class FolderModel
    {
        public string Id { get; set; }
        public string Name { get; set; }
        public string ParentId { get; set; }
        public string CategoryId { get; set; }
        public Dictionary<string, string> CategorySelections { get; set; }
        public string BackgroundImage { get; set; }
        public string CardBackgroundImage { get; set; }
        public int WidthSpan { get; set; }
        public long CreatedAt { get; set; }
        public long UpdatedAt { get; set; }
    }

    public class NoteModel
    {
        public string Id { get; set; }
        public string FolderId { get; set; }
        public string Title { get; set; }
        public string Subtitle { get; set; }
        public string ContentHtml { get; set; }
        public string PlainText { get; set; }
        public string CategoryId { get; set; }
        public Dictionary<string, string> CategorySelections { get; set; }
        public int WidthSpan { get; set; }
        public long CreatedAt { get; set; }
        public long UpdatedAt { get; set; }
    }

    public class AppData
    {
        public int SchemaVersion { get; set; }
        public List<FolderModel> Folders { get; set; }
        public List<NoteModel> Notes { get; set; }
        public List<CategoryModel> Categories { get; set; }

        public AppData()
        {
            Folders = new List<FolderModel>();
            Notes = new List<NoteModel>();
            Categories = new List<CategoryModel>();
        }
    }

    public class AppStore
    {
        private const int CurrentSchemaVersion = 3;
        private readonly JavaScriptSerializer serializer;
        private readonly string dataFile;

        public string AppDirectory { get; private set; }
        public AppData Data { get; private set; }

        public AppStore(JavaScriptSerializer sharedSerializer)
        {
            serializer = sharedSerializer;
            serializer.MaxJsonLength = Int32.MaxValue;

            string customDirectory = Environment.GetEnvironmentVariable("POLIA_DATA_DIR");
            if (!String.IsNullOrWhiteSpace(customDirectory))
            {
                AppDirectory = customDirectory;
            }
            else
            {
                AppDirectory = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "PoliaNotes"
                );
            }
            Directory.CreateDirectory(AppDirectory);
            dataFile = Path.Combine(AppDirectory, "notes.json");
            Load();
        }

        private void Load()
        {
            bool hadDataFile = File.Exists(dataFile);
            if (hadDataFile)
            {
                try
                {
                    string json = File.ReadAllText(dataFile, Encoding.UTF8);
                    Data = serializer.Deserialize<AppData>(json);
                }
                catch
                {
                    Data = null;
                }
            }
            if (Data == null) Data = new AppData();
            if (Data.Folders == null) Data.Folders = new List<FolderModel>();
            if (Data.Notes == null) Data.Notes = new List<NoteModel>();
            if (Data.Categories == null) Data.Categories = new List<CategoryModel>();
            Data.Folders.RemoveAll(delegate(FolderModel folder) { return folder == null || String.IsNullOrWhiteSpace(folder.Id); });
            Data.Notes.RemoveAll(delegate(NoteModel note) { return note == null || String.IsNullOrWhiteSpace(note.Id); });
            Data.Categories.RemoveAll(delegate(CategoryModel category) { return category == null || String.IsNullOrWhiteSpace(category.Id); });
            foreach (FolderModel folder in Data.Folders)
            {
                folder.WidthSpan = ClampWidth(folder.WidthSpan);
                if (folder.CategorySelections == null)
                    folder.CategorySelections = new Dictionary<string, string>();
            }
            foreach (NoteModel note in Data.Notes)
            {
                note.WidthSpan = ClampWidth(note.WidthSpan);
                if (note.CategorySelections == null)
                    note.CategorySelections = new Dictionary<string, string>();
                if (note.Subtitle == null) note.Subtitle = "";
            }
            bool needsMigration = Data.SchemaVersion < CurrentSchemaVersion;
            NormalizeCategoryScopes(needsMigration);
            NormalizeCategoryHierarchy();
            NormalizeItemCategorySelections();
            if (needsMigration)
            {
                Data.SchemaVersion = CurrentSchemaVersion;
                if (hadDataFile)
                {
                    try
                    {
                        Save();
                    }
                    catch
                    {
                        // Loading must still succeed if the migrated file cannot be written yet.
                    }
                }
            }
        }

        private static string ScopeId(string value)
        {
            return String.IsNullOrWhiteSpace(value) ? null : value.Trim();
        }

        private void NormalizeCategoryScopes(bool inferLegacyOwners)
        {
            var folderIds = new HashSet<string>();
            foreach (FolderModel folder in Data.Folders) folderIds.Add(folder.Id);

            var categoryMap = new Dictionary<string, CategoryModel>();
            foreach (CategoryModel category in Data.Categories)
            {
                category.OwnerFolderId = ScopeId(category.OwnerFolderId);
                if (category.OwnerFolderId != null && !folderIds.Contains(category.OwnerFolderId))
                {
                    category.OwnerFolderId = null;
                }
                categoryMap[category.Id] = category;
            }

            if (inferLegacyOwners) InferLegacyCategoryOwners();

            var migrated = new Dictionary<string, string>();
            foreach (FolderModel folder in Data.Folders)
            {
                folder.CategoryId = ResolveCategoryId(
                    folder.CategoryId,
                    ScopeId(folder.ParentId),
                    categoryMap,
                    migrated
                );
            }
            foreach (NoteModel note in Data.Notes)
            {
                note.CategoryId = ResolveCategoryId(
                    note.CategoryId,
                    ScopeId(note.FolderId),
                    categoryMap,
                    migrated
                );
            }
        }

        private void NormalizeCategoryHierarchy()
        {
            var categoryMap = new Dictionary<string, CategoryModel>();
            foreach (CategoryModel category in Data.Categories)
            {
                category.ParentCategoryId = ScopeId(category.ParentCategoryId);
                if (category.ParentCategoryId == category.Id)
                    category.ParentCategoryId = null;
                categoryMap[category.Id] = category;
            }

            foreach (CategoryModel category in Data.Categories)
            {
                if (category.ParentCategoryId == null) continue;
                CategoryModel parent;
                bool validParent = categoryMap.TryGetValue(category.ParentCategoryId, out parent)
                    && parent.ParentCategoryId == null
                    && String.Equals(
                        ScopeId(parent.OwnerFolderId),
                        ScopeId(category.OwnerFolderId),
                        StringComparison.Ordinal
                    );
                if (!validParent) category.ParentCategoryId = null;
            }
        }

        private void NormalizeItemCategorySelections()
        {
            var categoryMap = new Dictionary<string, CategoryModel>();
            foreach (CategoryModel category in Data.Categories)
                categoryMap[category.Id] = category;

            foreach (FolderModel folder in Data.Folders)
            {
                folder.CategorySelections = FilterCategorySelections(
                    folder.CategorySelections,
                    folder.CategoryId,
                    ScopeId(folder.ParentId),
                    categoryMap
                );
                folder.CategoryId = FirstSelectionId(folder.CategorySelections);
            }
            foreach (NoteModel note in Data.Notes)
            {
                note.CategorySelections = FilterCategorySelections(
                    note.CategorySelections,
                    note.CategoryId,
                    ScopeId(note.FolderId),
                    categoryMap
                );
                note.CategoryId = FirstSelectionId(note.CategorySelections);
            }
        }

        public List<string> DeleteCategory(string categoryId)
        {
            CategoryModel category = Data.Categories.FirstOrDefault(
                delegate(CategoryModel item) { return item.Id == categoryId; }
            );
            if (category == null) throw new InvalidOperationException("Категория не найдена");
            var removedIds = new HashSet<string>(StringComparer.Ordinal);
            removedIds.Add(category.Id);
            foreach (CategoryModel child in Data.Categories)
            {
                if (child.ParentCategoryId == category.Id
                    && String.Equals(
                        ScopeId(child.OwnerFolderId),
                        ScopeId(category.OwnerFolderId),
                        StringComparison.Ordinal))
                {
                    removedIds.Add(child.Id);
                }
            }
            Data.Categories.RemoveAll(
                delegate(CategoryModel item) { return removedIds.Contains(item.Id); }
            );
            NormalizeItemCategorySelections();
            Save();
            return removedIds.ToList();
        }

        private static Dictionary<string, string> FilterCategorySelections(
            Dictionary<string, string> values,
            string legacyCategoryId,
            string scopeId,
            Dictionary<string, CategoryModel> categoryMap)
        {
            var result = new Dictionary<string, string>();
            if (values != null)
            {
                foreach (KeyValuePair<string, string> pair in values)
                    AddValidSelection(result, pair.Value, scopeId, categoryMap);
            }
            AddValidSelection(result, legacyCategoryId, scopeId, categoryMap);
            return result;
        }

        private static void AddValidSelection(
            Dictionary<string, string> result,
            string categoryId,
            string scopeId,
            Dictionary<string, CategoryModel> categoryMap)
        {
            if (String.IsNullOrWhiteSpace(categoryId)) return;
            CategoryModel category;
            if (!categoryMap.TryGetValue(categoryId, out category)) return;
            if (!String.Equals(
                ScopeId(category.OwnerFolderId),
                scopeId,
                StringComparison.Ordinal)) return;

            string groupId = category.ParentCategoryId != null
                ? category.ParentCategoryId
                : category.Id;
            CategoryModel group;
            if (!categoryMap.TryGetValue(groupId, out group)) return;
            if (!String.Equals(
                ScopeId(group.OwnerFolderId),
                scopeId,
                StringComparison.Ordinal)) return;
            if (!result.ContainsKey(groupId)) result[groupId] = category.Id;
        }

        private static string FirstSelectionId(Dictionary<string, string> selections)
        {
            if (selections == null || selections.Count == 0) return null;
            return selections.Values.First();
        }

        private static void AddCategoryUsage(
            Dictionary<string, List<string>> usage,
            string categoryId,
            string scopeId)
        {
            if (String.IsNullOrWhiteSpace(categoryId)) return;
            List<string> scopes;
            if (!usage.TryGetValue(categoryId, out scopes))
            {
                scopes = new List<string>();
                usage[categoryId] = scopes;
            }
            if (!scopes.Contains(scopeId)) scopes.Add(scopeId);
        }

        private void InferLegacyCategoryOwners()
        {
            var usage = new Dictionary<string, List<string>>();
            foreach (FolderModel folder in Data.Folders)
            {
                AddCategoryUsage(usage, folder.CategoryId, ScopeId(folder.ParentId));
            }
            foreach (NoteModel note in Data.Notes)
            {
                AddCategoryUsage(usage, note.CategoryId, ScopeId(note.FolderId));
            }

            foreach (CategoryModel category in Data.Categories)
            {
                if (category.OwnerFolderId != null) continue;
                List<string> scopes;
                if (!usage.TryGetValue(category.Id, out scopes)) continue;
                string preferredScope = scopes.FirstOrDefault(
                    delegate(string scopeId) { return scopeId != null; }
                );
                if (preferredScope != null) category.OwnerFolderId = preferredScope;
            }
        }

        private string ResolveCategoryId(
            string categoryId,
            string scopeId,
            Dictionary<string, CategoryModel> categoryMap,
            Dictionary<string, string> migrated)
        {
            if (String.IsNullOrWhiteSpace(categoryId)) return null;
            CategoryModel source;
            if (!categoryMap.TryGetValue(categoryId, out source)) return null;
            if (String.Equals(ScopeId(source.OwnerFolderId), scopeId, StringComparison.Ordinal))
            {
                return source.Id;
            }

            string migrationKey = (scopeId ?? "") + "\n" + source.Id;
            string existingId;
            if (migrated.TryGetValue(migrationKey, out existingId)) return existingId;

            var clone = new CategoryModel();
            clone.Id = Guid.NewGuid().ToString();
            clone.Name = source.Name;
            clone.Color = source.Color;
            clone.OwnerFolderId = scopeId;
            clone.ParentCategoryId = source.ParentCategoryId;
            clone.CreatedAt = source.CreatedAt;
            clone.UpdatedAt = source.UpdatedAt;
            Data.Categories.Add(clone);
            categoryMap[clone.Id] = clone;
            migrated[migrationKey] = clone.Id;
            return clone.Id;
        }

        private bool CategoryBelongsToScope(string categoryId, string ownerFolderId)
        {
            if (String.IsNullOrWhiteSpace(categoryId)) return false;
            CategoryModel category = Data.Categories.FirstOrDefault(
                delegate(CategoryModel item) { return item.Id == categoryId; }
            );
            return category != null
                && String.Equals(
                    ScopeId(category.OwnerFolderId),
                    ScopeId(ownerFolderId),
                    StringComparison.Ordinal
                );
        }

        public static int ClampWidth(int value)
        {
            if (value < 1) return 2;
            return Math.Min(value, 8);
        }

        public void Save()
        {
            Directory.CreateDirectory(AppDirectory);
            string json = serializer.Serialize(Data);
            string tempFile = dataFile + ".tmp";
            File.WriteAllText(tempFile, json, new UTF8Encoding(false));
            if (File.Exists(dataFile))
            {
                File.Replace(tempFile, dataFile, null);
            }
            else
            {
                File.Move(tempFile, dataFile);
            }
        }

        public static long Now()
        {
            return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
        }
    }

    public class NoteBridge
    {
        private readonly AppStore store;
        private readonly JavaScriptSerializer serializer;
        private readonly WebView2 webView;

        public NoteBridge(WebView2 webView, AppStore store, JavaScriptSerializer serializer)
        {
            this.webView = webView;
            this.store = store;
            this.serializer = serializer;
        }

        private static string GetString(Dictionary<string, object> values, string key)
        {
            if (values == null || !values.ContainsKey(key) || values[key] == null) return null;
            return Convert.ToString(values[key], CultureInfo.InvariantCulture);
        }

        private static List<string> GetStringList(Dictionary<string, object> values, string key)
        {
            var result = new List<string>();
            if (values == null || !values.ContainsKey(key) || values[key] == null) return result;
            System.Collections.IEnumerable sequence = values[key] as System.Collections.IEnumerable;
            if (sequence != null && !(values[key] is string))
            {
                foreach (object item in sequence)
                {
                    string value = Convert.ToString(item, CultureInfo.InvariantCulture);
                    if (!String.IsNullOrWhiteSpace(value)) result.Add(value);
                }
                return result;
            }
            string single = Convert.ToString(values[key], CultureInfo.InvariantCulture);
            if (!String.IsNullOrWhiteSpace(single)) result.Add(single);
            return result;
        }

        private static string CleanName(string value, string fallback)
        {
            if (String.IsNullOrWhiteSpace(value)) return fallback;
            value = value.Trim();
            if (value.Length > 120) value = value.Substring(0, 120);
            return value;
        }

        private static int GetInt(Dictionary<string, object> values, string key, int fallback)
        {
            if (values == null || !values.ContainsKey(key) || values[key] == null) return fallback;
            try
            {
                return Convert.ToInt32(values[key], CultureInfo.InvariantCulture);
            }
            catch
            {
                return fallback;
            }
        }

        private static string CleanColor(string value)
        {
            string color = (value ?? "").Trim();
            bool valid = color.Length == 7 && color[0] == '#'
                && color.Skip(1).All(ch => Uri.IsHexDigit(ch));
            return valid ? color.ToUpperInvariant() : "#7D9B76";
        }

        private object FolderObject(FolderModel folder)
        {
            var result = new Dictionary<string, object>();
            result["id"] = folder.Id;
            result["name"] = folder.Name;
            result["parentId"] = folder.ParentId;
            result["categoryId"] = folder.CategoryId;
            result["categorySelections"] = CopyCategorySelections(folder.CategorySelections);
            result["backgroundImage"] = folder.BackgroundImage;
            result["cardBackgroundImage"] = folder.CardBackgroundImage;
            result["widthSpan"] = AppStore.ClampWidth(folder.WidthSpan);
            result["createdAt"] = folder.CreatedAt;
            result["updatedAt"] = folder.UpdatedAt;
            return result;
        }

        private object NoteObject(NoteModel note)
        {
            var result = new Dictionary<string, object>();
            result["id"] = note.Id;
            result["folderId"] = note.FolderId;
            result["title"] = note.Title;
            result["subtitle"] = note.Subtitle ?? "";
            result["contentHtml"] = note.ContentHtml;
            result["plainText"] = note.PlainText;
            result["categoryId"] = note.CategoryId;
            result["categorySelections"] = CopyCategorySelections(note.CategorySelections);
            result["widthSpan"] = AppStore.ClampWidth(note.WidthSpan);
            result["createdAt"] = note.CreatedAt;
            result["updatedAt"] = note.UpdatedAt;
            return result;
        }

        private object CategoryObject(CategoryModel category)
        {
            var result = new Dictionary<string, object>();
            result["id"] = category.Id;
            result["name"] = category.Name;
            result["color"] = CleanColor(category.Color);
            result["ownerFolderId"] = category.OwnerFolderId;
            result["parentCategoryId"] = category.ParentCategoryId;
            result["createdAt"] = category.CreatedAt;
            result["updatedAt"] = category.UpdatedAt;
            return result;
        }

        private bool FolderExists(string folderId)
        {
            if (String.IsNullOrWhiteSpace(folderId)) return false;
            return store.Data.Folders.Any(delegate(FolderModel folder) { return folder.Id == folderId; });
        }

        private static string ScopeId(string value)
        {
            return String.IsNullOrWhiteSpace(value) ? null : value.Trim();
        }

        private bool CategoryBelongsToScope(string categoryId, string ownerFolderId)
        {
            if (String.IsNullOrWhiteSpace(categoryId)) return false;
            CategoryModel category = store.Data.Categories.FirstOrDefault(
                delegate(CategoryModel item) { return item.Id == categoryId; }
            );
            return category != null
                && String.Equals(
                    ScopeId(category.OwnerFolderId),
                    ScopeId(ownerFolderId),
                    StringComparison.Ordinal
                );
        }

        private CategoryModel FindCategory(string categoryId)
        {
            if (String.IsNullOrWhiteSpace(categoryId)) return null;
            return store.Data.Categories.FirstOrDefault(
                delegate(CategoryModel item) { return item.Id == categoryId; }
            );
        }

        private static string CategoryGroupId(CategoryModel category)
        {
            if (category == null) return null;
            return category.ParentCategoryId != null
                ? category.ParentCategoryId
                : category.Id;
        }

        private static Dictionary<string, string> CopyCategorySelections(
            Dictionary<string, string> selections)
        {
            var result = new Dictionary<string, string>();
            if (selections == null) return result;
            foreach (KeyValuePair<string, string> pair in selections)
                result[pair.Key] = pair.Value;
            return result;
        }

        private static string FirstSelectionId(Dictionary<string, string> selections)
        {
            if (selections == null || selections.Count == 0) return null;
            return selections.Values.First();
        }

        private Dictionary<string, string> SanitizeCategorySelections(
            Dictionary<string, string> selections,
            string ownerFolderId)
        {
            var result = new Dictionary<string, string>();
            if (selections == null) return result;
            foreach (KeyValuePair<string, string> pair in selections)
            {
                CategoryModel category = FindCategory(pair.Value);
                if (category == null
                    || !String.Equals(
                        ScopeId(category.OwnerFolderId),
                        ScopeId(ownerFolderId),
                        StringComparison.Ordinal)) continue;
                string groupId = CategoryGroupId(category);
                if (!result.ContainsKey(groupId)) result[groupId] = category.Id;
            }
            return result;
        }

        public async void ReceiveMessage(object sender, CoreWebView2WebMessageReceivedEventArgs eventArgs)
        {
            string requestId = "";
            try
            {
                Dictionary<string, object> message = serializer.Deserialize<Dictionary<string, object>>(eventArgs.WebMessageAsJson);
                requestId = GetString(message, "id") ?? "";
                string command = GetString(message, "command") ?? "";
                object rawArgs;
                var arguments = message.TryGetValue("args", out rawArgs)
                    ? rawArgs as Dictionary<string, object>
                    : null;
                object result = await HandleCommandAsync(command, arguments);
                SendResponse(requestId, true, result, null);
            }
            catch (Exception error)
            {
                SendResponse(requestId, false, null, error.Message);
            }
        }

        private void SendResponse(string requestId, bool ok, object result, string error)
        {
            if (webView.CoreWebView2 == null) return;
            var response = new Dictionary<string, object>();
            response["id"] = requestId;
            response["ok"] = ok;
            response["result"] = result;
            response["error"] = error;
            webView.CoreWebView2.PostWebMessageAsJson(serializer.Serialize(response));
        }

        private async Task<object> HandleCommandAsync(string command, Dictionary<string, object> args)
        {
            switch (command)
            {
                case "load_state":
                {
                    var response = new Dictionary<string, object>();
                    response["folders"] = store.Data.Folders.Select(FolderObject).ToList();
                    response["notes"] = store.Data.Notes.Select(NoteObject).ToList();
                    response["categories"] = store.Data.Categories.Select(CategoryObject).ToList();
                    return response;
                }
                case "create_folder":
                {
                    string parentId = GetString(args, "parentId");
                    if (!FolderExists(parentId)) parentId = null;
                    long now = AppStore.Now();
                    var folder = new FolderModel();
                    folder.Id = Guid.NewGuid().ToString();
                    folder.Name = CleanName(GetString(args, "name"), "Новая папка");
                    folder.ParentId = parentId;
                    folder.WidthSpan = 2;
                    folder.CreatedAt = now;
                    folder.UpdatedAt = now;
                    store.Data.Folders.Add(folder);
                    store.Save();
                    return FolderObject(folder);
                }
                case "create_note":
                {
                    string folderId = GetString(args, "folderId");
                    if (!FolderExists(folderId)) folderId = null;
                    long now = AppStore.Now();
                    var note = new NoteModel();
                    note.Id = Guid.NewGuid().ToString();
                    note.FolderId = folderId;
                    note.Title = "Новая заметка";
                    note.Subtitle = "";
                    note.ContentHtml = "";
                    note.PlainText = "";
                    note.CategoryId = null;
                    note.CategorySelections = new Dictionary<string, string>();
                    note.WidthSpan = 2;
                    note.CreatedAt = now;
                    note.UpdatedAt = now;
                    store.Data.Notes.Add(note);
                    store.Save();
                    return NoteObject(note);
                }
                case "update_note":
                {
                    string noteId = GetString(args, "id");
                    NoteModel note = store.Data.Notes.FirstOrDefault(delegate(NoteModel item) { return item.Id == noteId; });
                    if (note == null) throw new InvalidOperationException("Заметка не найдена");
                    note.Title = CleanName(GetString(args, "title"), "Без названия");
                    if (args != null && args.ContainsKey("subtitle"))
                    {
                        string subtitle = (GetString(args, "subtitle") ?? "").Trim();
                        if (subtitle.Length > 240) subtitle = subtitle.Substring(0, 240);
                        note.Subtitle = subtitle;
                    }
                    note.ContentHtml = GetString(args, "contentHtml") ?? "";
                    note.PlainText = GetString(args, "plainText") ?? "";
                    note.UpdatedAt = AppStore.Now();
                    store.Save();
                    return NoteObject(note);
                }
                case "create_category":
                {
                    long now = AppStore.Now();
                    string parentCategoryId = ScopeId(GetString(args, "parentCategoryId"));
                    CategoryModel parent = FindCategory(parentCategoryId);
                    if (parent != null && parent.ParentCategoryId != null)
                        throw new InvalidOperationException("Вложенность категорий ограничена двумя уровнями");
                    string ownerFolderId = parent != null
                        ? ScopeId(parent.OwnerFolderId)
                        : ScopeId(GetString(args, "ownerFolderId"));
                    if (parent != null
                        && !String.Equals(
                            ScopeId(parent.OwnerFolderId),
                            ScopeId(GetString(args, "ownerFolderId")),
                            StringComparison.Ordinal)
                        && !String.IsNullOrWhiteSpace(GetString(args, "ownerFolderId")))
                    {
                        throw new InvalidOperationException("Категория находится в другой папке");
                    }
                    if (!FolderExists(ownerFolderId)) ownerFolderId = null;

                    var category = new CategoryModel();
                    category.Id = Guid.NewGuid().ToString();
                    category.Name = CleanName(GetString(args, "name"), "Новая категория");
                    string requestedColor = GetString(args, "color");
                    category.Color = CleanColor(
                        String.IsNullOrWhiteSpace(requestedColor) && parent != null
                            ? parent.Color
                            : requestedColor
                    );
                    category.OwnerFolderId = ownerFolderId;
                    category.ParentCategoryId = parent != null ? parent.Id : null;
                    category.CreatedAt = now;
                    category.UpdatedAt = now;
                    store.Data.Categories.Add(category);
                    store.Save();
                    return CategoryObject(category);
                }
                case "update_category":
                {
                    string categoryId = GetString(args, "id");
                    CategoryModel category = FindCategory(categoryId);
                    if (category == null) throw new InvalidOperationException("Категория не найдена");
                    string name = GetString(args, "name");
                    if (!String.IsNullOrWhiteSpace(name))
                        category.Name = CleanName(name, category.Name);
                    if (args != null && args.ContainsKey("color"))
                        category.Color = CleanColor(GetString(args, "color"));
                    string copyColorFromId = ScopeId(GetString(args, "copyColorFromId"));
                    if (copyColorFromId != null)
                    {
                        CategoryModel colorSource = FindCategory(copyColorFromId);
                        if (colorSource == null
                            || !String.Equals(
                                ScopeId(colorSource.OwnerFolderId),
                                ScopeId(category.OwnerFolderId),
                                StringComparison.Ordinal))
                        {
                            throw new InvalidOperationException("Нельзя взять цвет категории из другой папки");
                        }
                        category.Color = CleanColor(colorSource.Color);
                    }
                    category.UpdatedAt = AppStore.Now();
                    store.Save();
                    return CategoryObject(category);
                }
                case "delete_category":
                {
                    List<string> removedIds = store.DeleteCategory(GetString(args, "id"));
                    return new { deletedIds = removedIds };
                }
                case "reorder_categories":
                {
                    List<string> orderedIds = GetStringList(args, "categoryIds");
                    string ownerFolderId = ScopeId(GetString(args, "ownerFolderId"));
                    if (!FolderExists(ownerFolderId)) ownerFolderId = null;
                    string parentCategoryId = ScopeId(GetString(args, "parentCategoryId"));
                    var rank = new Dictionary<string, int>();
                    for (int index = 0; index < orderedIds.Count; index++)
                    {
                        if (!rank.ContainsKey(orderedIds[index])) rank[orderedIds[index]] = index;
                    }
                    List<CategoryModel> orderedCategories = store.Data.Categories
                        .Where(delegate(CategoryModel category)
                        {
                            return String.Equals(ScopeId(category.OwnerFolderId), ownerFolderId, StringComparison.Ordinal)
                                && String.Equals(ScopeId(category.ParentCategoryId), parentCategoryId, StringComparison.Ordinal)
                                && rank.ContainsKey(category.Id);
                        })
                        .OrderBy(delegate(CategoryModel category) { return rank[category.Id]; })
                        .ToList();
                    orderedCategories.AddRange(store.Data.Categories.Where(delegate(CategoryModel category)
                    {
                        return String.Equals(ScopeId(category.OwnerFolderId), ownerFolderId, StringComparison.Ordinal)
                            && String.Equals(ScopeId(category.ParentCategoryId), parentCategoryId, StringComparison.Ordinal)
                            && !rank.ContainsKey(category.Id);
                    }));
                    int cursor = 0;
                    for (int index = 0; index < store.Data.Categories.Count; index++)
                    {
                        CategoryModel category = store.Data.Categories[index];
                        if (!String.Equals(ScopeId(category.OwnerFolderId), ownerFolderId, StringComparison.Ordinal)) continue;
                        if (!String.Equals(ScopeId(category.ParentCategoryId), parentCategoryId, StringComparison.Ordinal)) continue;
                        store.Data.Categories[index] = orderedCategories[cursor++];
                    }
                    store.Save();
                    return store.Data.Categories.Select(CategoryObject).ToList();
                }
                case "set_item_category":
                case "set_note_category":
                {
                    string kind = command == "set_note_category"
                        ? "note"
                        : (GetString(args, "kind") ?? "").Trim().ToLowerInvariant();
                    string itemId = command == "set_note_category"
                        ? GetString(args, "noteId")
                        : GetString(args, "itemId");
                    string categoryId = GetString(args, "categoryId");
                    if (kind == "note")
                    {
                        NoteModel note = store.Data.Notes.FirstOrDefault(delegate(NoteModel item) { return item.Id == itemId; });
                        if (note == null) throw new InvalidOperationException("Заметка не найдена");
                        if (String.IsNullOrWhiteSpace(categoryId))
                        {
                            note.CategorySelections = new Dictionary<string, string>();
                            note.CategoryId = null;
                        }
                        else
                        {
                            CategoryModel category = FindCategory(categoryId);
                            if (category == null || !CategoryBelongsToScope(categoryId, note.FolderId))
                                throw new InvalidOperationException("Категория не найдена в этой папке");
                            if (note.CategorySelections == null)
                                note.CategorySelections = new Dictionary<string, string>();
                            note.CategorySelections[CategoryGroupId(category)] = category.Id;
                            note.CategoryId = category.Id;
                        }
                        note.UpdatedAt = AppStore.Now();
                        store.Save();
                        return NoteObject(note);
                    }
                    if (kind == "folder")
                    {
                        FolderModel folder = store.Data.Folders.FirstOrDefault(delegate(FolderModel item) { return item.Id == itemId; });
                        if (folder == null) throw new InvalidOperationException("Папка не найдена");
                        if (String.IsNullOrWhiteSpace(categoryId))
                        {
                            folder.CategorySelections = new Dictionary<string, string>();
                            folder.CategoryId = null;
                        }
                        else
                        {
                            CategoryModel category = FindCategory(categoryId);
                            if (category == null || !CategoryBelongsToScope(categoryId, folder.ParentId))
                                throw new InvalidOperationException("Категория не найдена в этой папке");
                            if (folder.CategorySelections == null)
                                folder.CategorySelections = new Dictionary<string, string>();
                            folder.CategorySelections[CategoryGroupId(category)] = category.Id;
                            folder.CategoryId = category.Id;
                        }
                        folder.UpdatedAt = AppStore.Now();
                        store.Save();
                        return FolderObject(folder);
                    }
                    throw new InvalidOperationException("Неизвестный тип карточки");
                }
                case "set_item_width":
                {
                    string kind = (GetString(args, "kind") ?? "").Trim().ToLowerInvariant();
                    string itemId = GetString(args, "itemId");
                    int width = AppStore.ClampWidth(GetInt(args, "widthSpan", 2));
                    if (kind == "note")
                    {
                        NoteModel note = store.Data.Notes.FirstOrDefault(delegate(NoteModel item) { return item.Id == itemId; });
                        if (note == null) throw new InvalidOperationException("Заметка не найдена");
                        note.WidthSpan = width;
                        store.Save();
                        return NoteObject(note);
                    }
                    if (kind == "folder")
                    {
                        FolderModel folder = store.Data.Folders.FirstOrDefault(delegate(FolderModel item) { return item.Id == itemId; });
                        if (folder == null) throw new InvalidOperationException("Папка не найдена");
                        folder.WidthSpan = width;
                        store.Save();
                        return FolderObject(folder);
                    }
                    throw new InvalidOperationException("Неизвестный тип карточки");
                }
                case "duplicate_note":
                {
                    string noteId = GetString(args, "id");
                    NoteModel source = store.Data.Notes.FirstOrDefault(delegate(NoteModel item) { return item.Id == noteId; });
                    if (source == null) throw new InvalidOperationException("Заметка не найдена");
                    long now = AppStore.Now();
                    var copy = new NoteModel();
                    copy.Id = Guid.NewGuid().ToString();
                    copy.FolderId = source.FolderId;
                    copy.Title = CleanName(source.Title + " (копия)", "Копия заметки");
                    copy.Subtitle = source.Subtitle;
                    copy.ContentHtml = source.ContentHtml;
                    copy.PlainText = source.PlainText;
                    copy.CategorySelections = CopyCategorySelections(source.CategorySelections);
                    copy.CategoryId = source.CategoryId;
                    string targetNoteId = GetString(args, "targetNoteId");
                    NoteModel targetNote = store.Data.Notes.FirstOrDefault(
                        delegate(NoteModel item) { return item.Id == targetNoteId; }
                    );
                    if (targetNote != null
                        && String.Equals(
                            ScopeId(targetNote.FolderId),
                            ScopeId(source.FolderId),
                            StringComparison.Ordinal))
                    {
                        copy.CategorySelections = CopyCategorySelections(targetNote.CategorySelections);
                        copy.CategoryId = targetNote.CategoryId;
                    }
                    copy.WidthSpan = AppStore.ClampWidth(source.WidthSpan);
                    copy.CreatedAt = now;
                    copy.UpdatedAt = now;
                    int sourceIndex = store.Data.Notes.IndexOf(source);
                    store.Data.Notes.Insert(sourceIndex + 1, copy);
                    store.Save();
                    return NoteObject(copy);
                }
                case "set_folder_background":
                {
                    string folderId = GetString(args, "folderId");
                    FolderModel folder = store.Data.Folders.FirstOrDefault(delegate(FolderModel item) { return item.Id == folderId; });
                    if (folder == null) throw new InvalidOperationException("Папка не найдена");
                    string source = (GetString(args, "backgroundImage") ?? "").Trim();
                    if (source.Length > 0 && (!source.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase) || source.IndexOf(";base64,", StringComparison.OrdinalIgnoreCase) < 0))
                    {
                        throw new InvalidOperationException("Некорректное изображение фона");
                    }
                    folder.BackgroundImage = source.Length == 0 ? null : source;
                    folder.UpdatedAt = AppStore.Now();
                    store.Save();
                    return FolderObject(folder);
                }
                case "set_folder_card_background":
                {
                    string folderId = GetString(args, "folderId");
                    FolderModel folder = store.Data.Folders.FirstOrDefault(delegate(FolderModel item) { return item.Id == folderId; });
                    if (folder == null) throw new InvalidOperationException("Папка не найдена");
                    string source = (GetString(args, "backgroundImage") ?? "").Trim();
                    if (source.Length > 0 && (!source.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase) || source.IndexOf(";base64,", StringComparison.OrdinalIgnoreCase) < 0))
                    {
                        throw new InvalidOperationException("Некорректное изображение фона карточки");
                    }
                    folder.CardBackgroundImage = source.Length == 0 ? null : source;
                    folder.UpdatedAt = AppStore.Now();
                    store.Save();
                    return FolderObject(folder);
                }
                case "reorder_notes":
                {
                    List<string> orderedIds = GetStringList(args, "noteIds");
                    if (orderedIds.Count < 2) return null;
                    var rank = new Dictionary<string, int>();
                    for (int index = 0; index < orderedIds.Count; index++)
                    {
                        if (!rank.ContainsKey(orderedIds[index])) rank[orderedIds[index]] = index;
                    }
                    List<NoteModel> orderedNotes = store.Data.Notes
                        .Where(delegate(NoteModel note) { return rank.ContainsKey(note.Id); })
                        .OrderBy(delegate(NoteModel note) { return rank[note.Id]; })
                        .ToList();
                    if (orderedNotes.Count < 2) return null;
                    int cursor = 0;
                    bool changed = false;
                    for (int index = 0; index < store.Data.Notes.Count; index++)
                    {
                        NoteModel note = store.Data.Notes[index];
                        if (!rank.ContainsKey(note.Id)) continue;
                        NoteModel replacement = orderedNotes[cursor++];
                        if (!Object.ReferenceEquals(note, replacement))
                        {
                            store.Data.Notes[index] = replacement;
                            changed = true;
                        }
                    }
                    if (changed) store.Save();
                    return null;
                }
                case "reorder_folders":
                {
                    List<string> orderedIds = GetStringList(args, "folderIds");
                    if (orderedIds.Count < 2) return null;
                    var rank = new Dictionary<string, int>();
                    for (int index = 0; index < orderedIds.Count; index++)
                    {
                        if (!rank.ContainsKey(orderedIds[index])) rank[orderedIds[index]] = index;
                    }
                    List<FolderModel> orderedFolders = store.Data.Folders
                        .Where(delegate(FolderModel folder) { return rank.ContainsKey(folder.Id); })
                        .OrderBy(delegate(FolderModel folder) { return rank[folder.Id]; })
                        .ToList();
                    if (orderedFolders.Count < 2) return null;
                    int cursor = 0;
                    bool changed = false;
                    for (int index = 0; index < store.Data.Folders.Count; index++)
                    {
                        FolderModel folder = store.Data.Folders[index];
                        if (!rank.ContainsKey(folder.Id)) continue;
                        FolderModel replacement = orderedFolders[cursor++];
                        if (!Object.ReferenceEquals(folder, replacement))
                        {
                            store.Data.Folders[index] = replacement;
                            changed = true;
                        }
                    }
                    if (changed) store.Save();
                    return null;
                }
                case "delete_items":
                {
                    var folderIds = new HashSet<string>(GetStringList(args, "folderIds"));
                    bool expanded = true;
                    while (expanded)
                    {
                        expanded = false;
                        foreach (FolderModel folder in store.Data.Folders.ToList())
                        {
                            if (!String.IsNullOrWhiteSpace(folder.ParentId) && folderIds.Contains(folder.ParentId) && !folderIds.Contains(folder.Id))
                            {
                                folderIds.Add(folder.Id);
                                expanded = true;
                            }
                        }
                    }
                    var noteIds = new HashSet<string>(GetStringList(args, "noteIds"));
                    int removedFolders = store.Data.Folders.RemoveAll(delegate(FolderModel folder) { return folderIds.Contains(folder.Id); });
                    int removedNotes = store.Data.Notes.RemoveAll(delegate(NoteModel note)
                    {
                        return noteIds.Contains(note.Id) || (!String.IsNullOrWhiteSpace(note.FolderId) && folderIds.Contains(note.FolderId));
                    });
                    int removedCategories = store.Data.Categories.RemoveAll(delegate(CategoryModel category)
                    {
                        return !String.IsNullOrWhiteSpace(category.OwnerFolderId)
                            && folderIds.Contains(category.OwnerFolderId);
                    });
                    foreach (FolderModel folder in store.Data.Folders)
                    {
                        folder.CategorySelections = SanitizeCategorySelections(
                            folder.CategorySelections,
                            folder.ParentId
                        );
                        folder.CategoryId = FirstSelectionId(folder.CategorySelections);
                        if (folder.CategoryId == null)
                            folder.CategorySelections = new Dictionary<string, string>();
                    }
                    foreach (NoteModel note in store.Data.Notes)
                    {
                        note.CategorySelections = SanitizeCategorySelections(
                            note.CategorySelections,
                            note.FolderId
                        );
                        note.CategoryId = FirstSelectionId(note.CategorySelections);
                        if (note.CategoryId == null)
                            note.CategorySelections = new Dictionary<string, string>();
                    }
                    if (removedFolders > 0 || removedNotes > 0 || removedCategories > 0) store.Save();
                    return null;
                }
                case "list_speech_engines":
                {
                    var engines = new List<object>();
                    foreach (RecognizerInfo info in SpeechRecognitionEngine.InstalledRecognizers())
                    {
                        var item = new Dictionary<string, object>();
                        item["language"] = info.Culture.Name;
                        item["name"] = info.Name;
                        engines.Add(item);
                    }
                    return engines;
                }
                case "recognize_speech":
                {
                    string preferred = GetString(args, "preferredLanguage") ?? "ru-RU";
                    return await Task.Run<object>(delegate { return RecognizeSpeech(preferred); });
                }
                default:
                    throw new InvalidOperationException("Неизвестная команда: " + command);
            }
        }

        private static Dictionary<string, object> RecognizeSpeech(string preferredLanguage)
        {
            IReadOnlyList<RecognizerInfo> installed = SpeechRecognitionEngine.InstalledRecognizers();
            if (installed.Count == 0)
            {
                throw new InvalidOperationException("В Windows не установлен модуль распознавания речи. Добавьте языковой пакет в параметрах системы.");
            }
            RecognizerInfo engine = installed.FirstOrDefault(delegate(RecognizerInfo info)
            {
                return String.Equals(info.Culture.Name, preferredLanguage, StringComparison.OrdinalIgnoreCase);
            });
            if (engine == null)
            {
                engine = installed.FirstOrDefault(delegate(RecognizerInfo info)
                {
                    return info.Culture.Name.StartsWith("ru", StringComparison.OrdinalIgnoreCase);
                });
            }
            if (engine == null)
            {
                engine = installed.FirstOrDefault(delegate(RecognizerInfo info)
                {
                    return info.Culture.Name.StartsWith("en", StringComparison.OrdinalIgnoreCase);
                });
            }
            if (engine == null) engine = installed[0];

            using (var recognizer = new SpeechRecognitionEngine(engine.Culture))
            {
                recognizer.LoadGrammar(new DictationGrammar());
                recognizer.SetInputToDefaultAudioDevice();
                recognizer.InitialSilenceTimeout = TimeSpan.FromSeconds(7);
                recognizer.EndSilenceTimeout = TimeSpan.FromSeconds(1.5);
                recognizer.EndSilenceTimeoutAmbiguous = TimeSpan.FromSeconds(1.5);
                RecognitionResult result = recognizer.Recognize(TimeSpan.FromSeconds(20));
                if (result == null || String.IsNullOrWhiteSpace(result.Text))
                {
                    throw new InvalidOperationException("Речь не распознана. Попробуйте ещё раз чуть ближе к микрофону.");
                }
                var response = new Dictionary<string, object>();
                response["text"] = result.Text.Trim();
                response["language"] = engine.Culture.Name;
                return response;
            }
        }
    }

    public class MainForm : Form
    {
        private readonly WebView2 webView;
        private readonly AppStore store;
        private readonly JavaScriptSerializer serializer;

        public MainForm()
        {
            serializer = new JavaScriptSerializer();
            serializer.MaxJsonLength = Int32.MaxValue;
            store = new AppStore(serializer);

            Text = "Pisa-nina — заметки";
            Width = 1180;
            Height = 780;
            MinimumSize = new Size(820, 600);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(244, 241, 233);
            AutoScaleMode = AutoScaleMode.Dpi;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
            catch { }

            webView = new WebView2();
            webView.Dock = DockStyle.Fill;
            webView.DefaultBackgroundColor = Color.FromArgb(244, 241, 233);
            Controls.Add(webView);
            Shown += OnWindowShown;
        }

        private string FindUiDirectory()
        {
            string besideExe = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "ui");
            if (File.Exists(Path.Combine(besideExe, "index.html"))) return besideExe;

            string projectUi = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "ui"));
            if (File.Exists(Path.Combine(projectUi, "index.html"))) return projectUi;

            string sourceUi = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "..", "..", "ui"));
            if (File.Exists(Path.Combine(sourceUi, "index.html"))) return sourceUi;

            return besideExe;
        }

        private void LogStartup(string message)
        {
            try
            {
                File.AppendAllText(
                    Path.Combine(store.AppDirectory, "startup.log"),
                    DateTime.Now.ToString("s") + " " + message + Environment.NewLine
                );
            }
            catch { }
        }

        private async void OnWindowShown(object sender, EventArgs eventArgs)
        {
            try
            {
                string uiDirectory = FindUiDirectory();
                if (!File.Exists(Path.Combine(uiDirectory, "index.html")))
                {
                    throw new DirectoryNotFoundException("Не найдена папка ui с интерфейсом приложения.");
                }

                string webViewData = Path.Combine(store.AppDirectory, "WebView2");
                Directory.CreateDirectory(webViewData);
                string testMode = Environment.GetEnvironmentVariable("POLIA_TEST_MODE");
                string browserArguments = "--disable-gpu --disable-gpu-compositing";
                if (testMode == "1")
                {
                    browserArguments += " --no-sandbox --remote-debugging-port=9333";
                }
                CoreWebView2EnvironmentOptions environmentOptions = new CoreWebView2EnvironmentOptions(browserArguments);
                CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(null, webViewData, environmentOptions);
                await webView.EnsureCoreWebView2Async(environment);

                CoreWebView2 core = webView.CoreWebView2;
                core.Settings.AreDevToolsEnabled = false;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.AreDefaultContextMenusEnabled = true;
                core.Settings.IsZoomControlEnabled = false;
                core.Settings.AreBrowserAcceleratorKeysEnabled = true;
                core.NavigationStarting += delegate(object navigationSender, CoreWebView2NavigationStartingEventArgs navigationArgs)
                {
                    LogStartup("navigation starting: " + navigationArgs.Uri);
                    if (!navigationArgs.Uri.StartsWith("https://polia.local/", StringComparison.OrdinalIgnoreCase))
                    {
                        navigationArgs.Cancel = true;
                        LogStartup("navigation blocked: " + navigationArgs.Uri);
                    }
                };
                core.DOMContentLoaded += delegate(object domSender, CoreWebView2DOMContentLoadedEventArgs domArgs)
                {
                    LogStartup("dom content loaded");
                };
                core.NavigationCompleted += delegate(object navigationDoneSender, CoreWebView2NavigationCompletedEventArgs navigationDoneArgs)
                {
                    LogStartup("navigation completed: success=" + navigationDoneArgs.IsSuccess + " status=" + navigationDoneArgs.WebErrorStatus + " http=" + navigationDoneArgs.HttpStatusCode);
                };
                core.ProcessFailed += delegate(object processSender, CoreWebView2ProcessFailedEventArgs processArgs)
                {
                    LogStartup("webview process failed: " + processArgs.ProcessFailedKind.ToString());
                };
                core.NewWindowRequested += delegate(object newWindowSender, CoreWebView2NewWindowRequestedEventArgs newWindowArgs)
                {
                    newWindowArgs.Handled = true;
                };
                core.PermissionRequested += delegate(object permissionSender, CoreWebView2PermissionRequestedEventArgs permissionArgs)
                {
                    if (permissionArgs.PermissionKind == CoreWebView2PermissionKind.Microphone)
                    {
                        permissionArgs.State = CoreWebView2PermissionState.Allow;
                    }
                };

                var bridge = new NoteBridge(webView, store, serializer);
                core.WebMessageReceived += bridge.ReceiveMessage;
                core.SetVirtualHostNameToFolderMapping("polia.local", uiDirectory, CoreWebView2HostResourceAccessKind.Allow);
                LogStartup("navigating to ui: " + uiDirectory);
                core.Navigate("https://polia.local/index.html");
            }
            catch (Exception error)
            {
                MessageBox.Show(
                    "Не удалось открыть приложение.\n\n" + error.Message +
                    "\n\nПроверьте, что установлен Microsoft Edge WebView2 Runtime.",
                    "Pisa-nina",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                Close();
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs eventArgs)
        {
            try { store.Save(); }
            catch { }
            base.OnFormClosing(eventArgs);
        }
    }

    public static class Program
    {
        [STAThread]
        public static void Main()
        {
            bool createdNew;
            using (var mutex = new Mutex(true, "PoliaNotes.Desktop.SingleInstance", out createdNew))
            {
                if (!createdNew)
                {
                    MessageBox.Show("Приложение Pisa-nina уже открыто.", "Pisa-nina", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new MainForm());
            }
        }
    }
}





