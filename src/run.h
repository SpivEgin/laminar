///
/// Copyright 2016 Oliver Giles
///
/// This file is part of Laminar
///
/// Laminar is free software: you can redistribute it and/or modify
/// it under the terms of the GNU General Public License as published by
/// the Free Software Foundation, either version 3 of the License, or
/// (at your option) any later version.
///
/// Laminar is distributed in the hope that it will be useful,
/// but WITHOUT ANY WARRANTY; without even the implied warranty of
/// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
/// GNU General Public License for more details.
///
/// You should have received a copy of the GNU General Public License
/// along with Laminar.  If not, see <http://www.gnu.org/licenses/>
///
#ifndef _LAMINAR_RUN_H_
#define _LAMINAR_RUN_H_

#include <string>
#include <queue>
#include <list>
#include <functional>
#include <ostream>
#include <unordered_map>

enum class RunState {
    UNKNOWN,
    PENDING,
    RUNNING,
    ABORTED,
    FAILED,
    SUCCESS
};

std::string to_string(const RunState& rs);

class Node;

// Represents an execution of a job. Not much more than POD
class Run {
public:
    Run();
    ~Run();

    // copying this class would be asking for trouble...
    Run(const Run&) = delete;
    Run& operator=(const Run&) = delete;

    // executes the next script (if any), returning true if there is nothing
    // more to be done - in this case the caller should call complete()
    bool step();

    // call this when all scripts are done to get the notifyCompletion callback
    void complete();

    // adds a script to the queue of scripts to be executed by this run
    void addScript(std::string script);

    // adds an environment file that will be sourced before this run
    void addEnv(std::string path);

    // called when a process owned by this run has been reaped. The status
    // may be used to set the run's job status
    void reaped(int status);

    std::string reason() const;

    std::function<void(Run*)> notifyCompletion;
    Node* node;
    RunState result;
    RunState lastResult;
    std::string laminarHome;
    std::string name;
    std::string wd;
    std::string parentName;
    int parentBuild = 0;
    std::string reasonMsg;
    int build = 0;
    std::string log;
    pid_t pid;
    int fd;
    int procStatus;
    std::unordered_map<std::string, std::string> params;

    time_t queuedAt;
    time_t startedAt;
private:
    std::queue<std::string> scripts;
    std::string currentScript;
    std::list<std::string> env;
};


// All this below is a somewhat overengineered method of keeping track of
// currently executing builds (Run objects). This would probably scale
// very well, but it's completely gratuitous since we are not likely to
// be executing thousands of builds at the same time
#include <boost/multi_index_container.hpp>
#include <boost/multi_index/hashed_index.hpp>
#include <boost/multi_index/member.hpp>
#include <boost/multi_index/composite_key.hpp>
#include <boost/multi_index/global_fun.hpp>
#include <boost/multi_index/random_access_index.hpp>
#include <boost/multi_index/ordered_index.hpp>

namespace bmi = boost::multi_index;

struct _run_same {
    typedef const Run* result_type;
    const Run* operator()(const std::shared_ptr<Run>& run) const {
        return run.get();
    }
};

// A single Run can be fetched by...
struct _run_index : bmi::indexed_by<
        // their current running pid
        bmi::hashed_unique<bmi::member<Run, pid_t, &Run::pid>>,
        bmi::hashed_unique<bmi::composite_key<
            std::shared_ptr<Run>,
        // a combination of their job name and build number
            bmi::member<Run, std::string, &Run::name>,
            bmi::member<Run, int, &Run::build>
        >>,
        // or a pointer to a Run object.
        bmi::hashed_unique<_run_same>,
        // A group of Runs can be fetched by the time they started
        bmi::ordered_non_unique<bmi::member<Run, time_t, &Run::startedAt>>,
        // or by their job name
        bmi::ordered_non_unique<bmi::member<Run, std::string, &Run::name>>
    >
{};

struct RunSet: public boost::multi_index_container<
    std::shared_ptr<Run>,
    _run_index
> {
    // TODO: getters for each index
};

#endif // _LAMINAR_RUN_H_
