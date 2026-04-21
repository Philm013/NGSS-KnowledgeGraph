# NGSS Data Files (JSON)

This directory contains the raw data for the Next Generation Science Standards (NGSS), structured in JSON format. These files serve as the database for the NGSS-related applications in this repository.

## File Contents

The data is broken down into several files for optimized loading by the applications:

-   **`ngss3DElements.json`**: Contains the core definitions and progressions for the Three Dimensions of the NGSS:
    -   Science and Engineering Practices (SEPs)
    -   Disciplinary Core Ideas (DCIs)
    -   Crosscutting Concepts (CCCs)
-   **`ngssK5.json`**: Includes all Performance Expectations (PEs) for grades Kindergarten through 5.
-   **`ngss68.json`**: Includes all Performance Expectations (PEs) for grades 6 through 8 (Middle School).
-   **`ngss912.json`**: Includes all Performance Expectations (PEs) for grades 9 through 12 (High School).

Each Performance Expectation is linked to its corresponding 3D elements.

## Usage

These files are fetched and processed by the following applications in this portfolio:

-   **[NGSS-Explorer](../NGSS-Explorer/index.html)**: An interactive tool to browse, filter, and analyze the NGSS standards.
-   **[NGSS-Tracker](../NGSS-Tracker/index.html)**: A curriculum mapping tool for planning and tracking the implementation of NGSS standards.

The applications cache this data in the browser's IndexedDB on first load to ensure fast performance on subsequent visits.