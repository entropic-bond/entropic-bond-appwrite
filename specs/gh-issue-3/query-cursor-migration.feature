Feature: AppWrite data sources expose per-query pagination cursors
  As an application using @entropic-bond/appwrite 2.0.0
  I want each AppWrite query to own its pagination cursor
  So that interleaved find/next calls on a single data source do not mix result sets

  Background:
    Given an AppWrite data source is the active data source
    And a collection containing the ordered documents "user1" to "user6"

  Scenario: A bounded query pages through its result set. Issue #3 [REQ-1]
    Given a model for the collection
    When the model finds the first 2 documents
    And the model requests the next page
    Then the model receives documents "user3" and "user4"

  Scenario: Interleaved pagination on two queries of one data source keeps each result set. Issue #3 [REQ-2]
    Given a model for the collection
    And a second model for the collection
    When the first model finds the first 2 documents
    And the second model finds the first 3 documents
    And the first model requests the next page
    And the second model requests the next page
    Then the first model receives documents "user3" and "user4"
    And the second model receives documents "user4", "user5" and "user6"

  Scenario: An explicit page size overrides the query page size. Issue #3 [REQ-3]
    Given a model for the collection
    When the model finds the first 2 documents
    And the model requests the next 3 documents
    Then the model receives documents "user3", "user4" and "user5"

  Scenario: An unbounded query returns every matching document on the first page. Issue #3 [REQ-4]
    Given a model for the collection
    When the model finds all documents
    Then the model receives 6 documents

  Scenario: Requesting a page past the end of the result set returns no documents. Issue #3 [REQ-5]
    Given a model for the collection
    When the model finds the first 2 documents
    And the model requests the next page
    And the model requests the next page
    And the model requests the next page
    Then the model receives no documents

  Scenario: A collection change delivers the resolved snapshot of the watched query. Issue #3 [REQ-6]
    Given a model with a collection change listener for a query
    When a matching document changes
    Then the listener receives an array of documents as the snapshot
