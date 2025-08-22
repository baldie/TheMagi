#!/bin/bash

# erase-all.sh - Clear the vector database for The Magi personal data
# This script will permanently delete all stored personal data

set -e

# Colors for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Vector database paths - check both possible locations
VECTOR_DB_PATHS=(
    ".magi-data/personal-data-index"                    # Root directory
    "services/orchestrator/.magi-data/personal-data-index"  # Orchestrator directory
)

echo -e "${YELLOW}⚠️  WARNING: This will permanently delete ALL personal data from the vector database!${NC}"
echo
echo "This action will:"
echo "  • Delete the entire vector database index"
echo "  • Remove all stored personal information"
echo "  • Clear all embeddings and metadata"
echo
echo -e "${RED}This action CANNOT be undone!${NC}"
echo

# Check which database directories exist
EXISTING_PATHS=()
for path in "${VECTOR_DB_PATHS[@]}"; do
    if [ -d "$path" ]; then
        EXISTING_PATHS+=("$path")
    fi
done

if [ ${#EXISTING_PATHS[@]} -eq 0 ]; then
    echo -e "${YELLOW}No vector database directories found.${NC}"
    echo "Nothing to delete."
    exit 0
fi

# Show what will be deleted
echo "The following directories and all their contents will be deleted:"
for path in "${EXISTING_PATHS[@]}"; do
    echo "  $path"
done
echo

# First confirmation
read -p "Are you sure you want to delete ALL personal data? (yes/no): " confirm1

if [[ $confirm1 != "yes" ]]; then
    echo "Operation cancelled."
    exit 0
fi

# Second confirmation for extra safety
echo
echo -e "${RED}FINAL WARNING: This will permanently delete all your personal data!${NC}"
read -p "Type 'DELETE EVERYTHING' to confirm: " confirm2

if [[ $confirm2 != "DELETE EVERYTHING" ]]; then
    echo "Operation cancelled."
    exit 0
fi

echo
echo "Deleting vector database directories..."

# Remove each directory and all its contents
FAILED_DELETIONS=()
for path in "${EXISTING_PATHS[@]}"; do
    echo "Deleting $path..."
    if rm -rf "$path"; then
        echo -e "${GREEN}✅ Successfully deleted $path${NC}"
    else
        echo -e "${RED}❌ Failed to delete $path${NC}"
        FAILED_DELETIONS+=("$path")
    fi
done

if [ ${#FAILED_DELETIONS[@]} -eq 0 ]; then
    echo
    echo -e "${GREEN}✅ All vector database directories have been successfully deleted.${NC}"
    echo "All personal data has been cleared."
else
    echo
    echo -e "${RED}❌ Some deletions failed:${NC}"
    for path in "${FAILED_DELETIONS[@]}"; do
        echo "  $path"
    done
    echo "Please check permissions and try again."
    exit 1
fi

echo
echo "To start storing data again, simply use the personal data tools - the database will be recreated automatically."