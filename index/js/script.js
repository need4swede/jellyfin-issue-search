document.addEventListener('DOMContentLoaded', function () {
    // Clear the search bar on page load
    document.getElementById('search-bar').value = '';

    document.getElementById('search-bar').addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
            searchIssues();
        }
    });
});

async function searchIssues() {
    const query = document.getElementById('search-bar').value.toLowerCase().trim();

    if (!query) {
        return;
    }

    const openIssuesUrl = `https://api.github.com/search/issues?q=repo:jellyfin/jellyfin+is:issue+is:open+created:>=2024-05-11+${encodeURIComponent(query)}`;
    const closedIssuesUrl = `https://api.github.com/search/issues?q=repo:jellyfin/jellyfin+is:issue+is:closed+created:>=2024-05-11+${encodeURIComponent(query)}`;

    const [openResults, closedResults] = await Promise.all([
        fetch(openIssuesUrl)
            .then(response => response.json())
            .then(data => data.items || [])
            .catch(error => {
                console.error('Error:', error);
                return [];
            }),
        fetch(closedIssuesUrl)
            .then(response => response.json())
            .then(data => data.items || [])
            .catch(error => {
                console.error('Error:', error);
                return [];
            })
    ]);

    // Filter issues to include only those with all terms in the title
    const filteredOpenResults = filterResults(openResults, query);
    const filteredClosedResults = filterResults(closedResults, query);

    // Get comments for each issue and check for members or contributors
    const openResultsWithComments = await Promise.all(filteredOpenResults.map(async issue => {
        issue.memberComments = await getCommentsByTag(issue, 'MEMBER');
        issue.contributorComments = await getCommentsByTag(issue, 'CONTRIBUTOR');
        issue.duplicateComment = await getDuplicateComment(issue);
        return issue;
    }));

    const closedResultsWithComments = await Promise.all(filteredClosedResults.map(async issue => {
        issue.memberComments = await getCommentsByTag(issue, 'MEMBER');
        issue.contributorComments = await getCommentsByTag(issue, 'CONTRIBUTOR');
        issue.duplicateComment = await getDuplicateComment(issue);
        return issue;
    }));

    displayResults(closedResultsWithComments, openResultsWithComments);
}

function filterResults(issues, query) {
    const terms = query.split(' ');
    return issues.filter(issue => {
        const title = issue.title.toLowerCase();
        return terms.every(term => title.includes(term));
    });
}

async function getCommentsByTag(issue, tag) {
    const commentsUrl = issue.comments_url;
    const comments = await fetch(commentsUrl)
        .then(response => response.json())
        .catch(error => {
            console.error('Error fetching comments:', error);
            return [];
        });

    return comments.filter(comment => comment.author_association === tag && comment.user.login !== 'jellyfin-bot');
}

async function getDuplicateComment(issue) {
    const commentsUrl = issue.comments_url;
    const comments = await fetch(commentsUrl)
        .then(response => response.json())
        .catch(error => {
            console.error('Error fetching comments:', error);
            return [];
        });

    return comments.find(comment => /duplicate of #\d+/i.test(comment.body));
}

function replaceIssueLinks(text) {
    const issueLinkPattern = /#(\d+)/g;
    const repoUrl = 'https://github.com/jellyfin/jellyfin/issues/';
    return text.replace(issueLinkPattern, (match, issueNumber) => {
        return `<a href="${repoUrl}${issueNumber}" target="_blank" class="comment-issue-link">${match}</a>`;
    });
}

function displayResults(closedIssues, openIssues) {
    const closedDiv = document.getElementById('closed-results');
    const repliedDiv = document.getElementById('replied-results');
    const pendingDiv = document.getElementById('pending-results');

    closedDiv.innerHTML = '<h2>Closed</h2>';
    repliedDiv.innerHTML = '<h2>Replied</h2>';
    pendingDiv.innerHTML = '<h2>Pending</h2>';

    if (closedIssues.length === 0 && openIssues.length === 0) {
        closedDiv.innerHTML += '<p>No results found.</p>';
        repliedDiv.innerHTML += '<p>No results found.</p>';
        pendingDiv.innerHTML += '<p>No results found.</p>';
        return;
    }

    // Closed issues section
    if (closedIssues.length > 0) {
        closedIssues.forEach(issue => {
            const issueDiv = createIssueDiv(issue);
            addCommentsToIssue(issue, issueDiv);
            closedDiv.appendChild(issueDiv);
        });
    }

    // Replied issues section
    let hasRepliedIssues = false;

    openIssues.forEach(issue => {
        const issueDiv = createIssueDiv(issue);

        let comments = [];
        let commentAuthors = new Set();

        // Get the latest comment from each author
        const latestMemberComments = getLatestComments(issue.memberComments, commentAuthors);
        const latestContributorComments = getLatestComments(issue.contributorComments, commentAuthors);

        comments = latestMemberComments.concat(latestContributorComments);

        if (comments.length > 0) {
            const commentsDiv = document.createElement('div');
            commentsDiv.classList.add('comments');

            comments.forEach(comment => {
                const commentDiv = document.createElement('div');
                commentDiv.classList.add('comment');

                let authorClass = 'regular-member'; // Default to regular member (blue)
                if (comment.author_association === 'MEMBER') {
                    authorClass = 'member';
                } else if (comment.author_association === 'CONTRIBUTOR') {
                    authorClass = 'contributor';
                }

                // Replace issue links in the comment body
                const commentBody = replaceIssueLinks(trimComment(removeQuotedText(comment.body)));

                commentDiv.innerHTML = `<strong class="${authorClass}">${comment.user.login}:</strong> ${commentBody}`;

                commentsDiv.appendChild(commentDiv);
            });

            // Add the disclaimer if there are more comments from the same authors
            if (issue.memberComments.length > latestMemberComments.length || issue.contributorComments.length > latestContributorComments.length) {
                const disclaimerDiv = document.createElement('div');
                disclaimerDiv.classList.add('disclaimer');
                disclaimerDiv.textContent = "Previous responses were omitted. Open the issue to read more.";
                commentsDiv.appendChild(disclaimerDiv);
            }

            issueDiv.appendChild(commentsDiv);
            repliedDiv.appendChild(issueDiv);
            hasRepliedIssues = true;
        } else {
            pendingDiv.appendChild(issueDiv);
        }
    });

    if (!hasRepliedIssues) {
        repliedDiv.innerHTML += '<p>No results found.</p>';
    }
}

function createIssueDiv(issue) {
    const issueDiv = document.createElement('div');
    issueDiv.classList.add('issue');

    const issueLink = document.createElement('a');
    issueLink.href = issue.html_url;
    issueLink.target = '_blank';
    issueLink.textContent = issue.title;

    issueDiv.appendChild(issueLink);

    return issueDiv;
}

function addCommentsToIssue(issue, issueDiv) {
    let comments = [];
    let commentAuthors = new Set();

    // Get the latest comment from each author
    const latestMemberComments = getLatestComments(issue.memberComments, commentAuthors);
    const latestContributorComments = getLatestComments(issue.contributorComments, commentAuthors);

    comments = latestMemberComments.concat(latestContributorComments);

    if (comments.length > 0) {
        const commentsDiv = document.createElement('div');
        commentsDiv.classList.add('comments');

        comments.forEach(comment => {
            const commentDiv = document.createElement('div');
            commentDiv.classList.add('comment');

            let authorClass = 'regular-member'; // Default to regular member (blue)
            if (comment.author_association === 'MEMBER') {
                authorClass = 'member';
            } else if (comment.author_association === 'CONTRIBUTOR') {
                authorClass = 'contributor';
            }

            // Replace issue links in the comment body
            const commentBody = replaceIssueLinks(trimComment(removeQuotedText(comment.body)));

            commentDiv.innerHTML = `<strong class="${authorClass}">${comment.user.login}:</strong> ${commentBody}`;

            commentsDiv.appendChild(commentDiv);
        });

        // Add the disclaimer if there are more comments from the same authors
        if (issue.memberComments.length > latestMemberComments.length || issue.contributorComments.length > latestContributorComments.length) {
            const disclaimerDiv = document.createElement('div');
            disclaimerDiv.classList.add('disclaimer');
            disclaimerDiv.textContent = "Previous responses were omitted. Open the issue to read more.";
            commentsDiv.appendChild(disclaimerDiv);
        }

        issueDiv.appendChild(commentsDiv);
    }
}

function getLatestComments(comments, commentAuthors) {
    const latestComments = [];
    const commentMap = new Map();

    comments.forEach(comment => {
        commentMap.set(comment.user.login, comment);
    });

    commentMap.forEach((comment, author) => {
        commentAuthors.add(author);
        latestComments.push(comment);
    });

    return latestComments;
}

function getTrimmedDuplicateComment(commentBody) {
    const match = commentBody.match(/duplicate of #(\d+)/i);
    if (match) {
        const issueNumber = match[1];
        const issueUrl = `https://github.com/jellyfin/jellyfin/issues/${issueNumber}`;
        return `Duplicate of <a href="${issueUrl}" target="_blank" class="comment-issue-link">#${issueNumber}</a>`;
    }
    return commentBody;
}

function trimComment(commentBody) {
    const maxLength = 200;
    if (commentBody.length > maxLength) {
        return commentBody.slice(0, maxLength) + '...';
    }
    return commentBody;
}

function removeQuotedText(commentBody) {
    return commentBody.replace(/(^|\n)\s*>\s*.*(\n|$)/g, '').trim();
}
