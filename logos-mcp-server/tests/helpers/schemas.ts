// SQLite schemas for test fixtures. Table and column names are copied from a
// Logos 54.0 install on Windows (2026-10-15); only the columns the server
// reads are kept, and catalog columns get defaults so tests can insert
// partial rows. "Legacy" is the shape the pre-Logos-54 code expects.

export const NOTES_SCHEMA_LEGACY = `
  CREATE TABLE Notes (
    NoteId integer primary key autoincrement,
    ExternalId text not null,
    CreatedDate text not null,
    ModifiedDate text,
    IsDeleted bool not null default 0,
    IsTrashed bool not null default 0,
    Kind int not null,
    ContentRichText text,
    NoteStyleId int,
    AnchorsJson text,
    AnchorResourceIdId int,
    TagsJson text,
    NotebookExternalId text not null
  );
  CREATE TABLE Notebooks (
    NotebookId integer primary key autoincrement,
    ExternalId text not null,
    Title text,
    IsDeleted bool not null default 0
  );
  CREATE TABLE NoteStyles (
    NoteStyleId integer primary key autoincrement,
    Name text not null
  );
  CREATE TABLE ResourceIds (
    ResourceIdId integer primary key autoincrement,
    ResourceId text not null
  );
`;

export const NOTES_SCHEMA_LOGOS54 = `${NOTES_SCHEMA_LEGACY}
  CREATE TABLE NoteAnchorFacetReferences (
    NoteAnchorFacetReferenceId integer primary key autoincrement,
    NoteId integer not null,
    AnchorIndex int not null,
    DataTypeId int not null,
    BibleBook int,
    SortKey blob not null,
    Reference text not null
  );
`;

export const CATALOG_SCHEMA = `
  CREATE TABLE Records (
    RecordId integer primary key autoincrement,
    ResourceId text not null,
    Type text not null,
    Title text not null,
    AbbreviatedTitle text not null default '',
    Authors text not null default '',
    Series text not null default '',
    Subjects text not null default '',
    Description text,
    PublicationDate text not null default '',
    CommunityRating double,
    Traits text not null default '',
    Availability int not null default 2,
    IsDataset bool not null default 0,
    ReferenceSupersets text not null default '',
    UseCount integer not null default 0
  );
`;

export const AUTOCOMPLETE_SCHEMA = `
  CREATE TABLE Terms (
    TermId integer primary key autoincrement,
    Reference text unique not null,
    IconKindId integer not null,
    CompletionKind integer not null
  );
  CREATE TABLE Descriptions (
    DescriptionId integer primary key autoincrement,
    TermId integer not null,
    LanguageId integer not null,
    Description text not null
  );
  CREATE TABLE Labels (
    LabelId integer primary key autoincrement,
    TermId integer not null,
    IsPrimary bool not null,
    LanguageId integer not null,
    LabelText text not null
  );
  CREATE TABLE Languages (
    LanguageId integer primary key autoincrement,
    Language text not null
  );
  CREATE TABLE IconKinds (
    IconKindId integer primary key autoincrement,
    IconKind text not null
  );
`;

export const READING_PLAN_SCHEMA = `
  CREATE TABLE ReadingPlanDocuments (
    Id integer primary key autoincrement,
    DocumentId text not null,
    Title text,
    Settings text,
    ScheduleId guid,
    Sessions text,
    ModifiedDate text,
    IsDeleted int not null default 0
  );
  CREATE TABLE ReadingPlanStatus (
    Id integer primary key autoincrement,
    SyncId text not null,
    ResourceId text,
    ReadSessions text,
    ModifiedDate text,
    IsDeleted int not null default 0
  );
`;

// The older reading-list store (present but empty on Logos 54, F9).
export const READING_LISTS_SCHEMA = `
  CREATE TABLE ReadingListStatuses (
    ReadingListStatusId integer primary key autoincrement,
    ReadingListPathNormalized text not null,
    ModifiedDate text,
    IsDeleted bool not null default 0,
    Title text not null,
    Author text not null,
    Path text not null,
    Status int not null
  );
  CREATE TABLE Items (
    ItemRowId integer primary key autoincrement,
    ItemId text not null,
    ReadingListPathNormalized text not null,
    IsRead bool not null default 0,
    ModifiedDate text
  );
`;

export const READING_PROGRESS_SCHEMA = `
  CREATE TABLE ResourceReadingProgress (
    RowId integer primary key autoincrement,
    SyncId text not null,
    ResourceId text not null,
    Version text not null,
    IsDeleted bool not null default 0,
    ModifiedDate text,
    SyncState int not null default 0,
    Ranges text not null default '[]'
  );
  CREATE TABLE ReadingStatus (
    RowId integer primary key autoincrement,
    ResourceId text unique not null,
    Ranges text not null default '[]',
    PercentageRead double not null default 0
  );
`;
