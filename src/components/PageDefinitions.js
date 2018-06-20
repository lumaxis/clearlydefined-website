// Copyright (c) Microsoft Corporation and others. Licensed under the MIT license.
// SPDX-License-Identifier: MIT

import React, { Component } from 'react'
import { connect } from 'react-redux'
import { Grid, Row, Col, Button, DropdownButton, MenuItem } from 'react-bootstrap'
import { ROUTE_DEFINITIONS, ROUTE_INSPECT, ROUTE_CURATE } from '../utils/routingConstants'
import { getDefinitionsAction } from '../actions/definitionActions'
import { curateAction } from '../actions/curationActions'
import { FilterBar, ComponentList, Section, FacetSelect, ContributePrompt } from './'
import { uiNavigation, uiBrowseUpdateList, uiBrowseUpdateFilterList, uiNotificationNew } from '../actions/ui'
import EntitySpec from '../utils/entitySpec'
import { set, get, find } from 'lodash'
import { saveAs } from 'file-saver'
import Dropzone from 'react-dropzone'

const defaultFacets = [{ value: 'core', label: 'Core' }]

class PageDefinitions extends Component {
  constructor(props) {
    super(props)
    this.state = { activeFacets: defaultFacets.map(x => x.value), sortCounter: 0 }
    this.onAddComponent = this.onAddComponent.bind(this)
    this.onDrop = this.onDrop.bind(this)
    this.onSearch = this.onSearch.bind(this)
    this.onInspect = this.onInspect.bind(this)
    this.onCurate = this.onCurate.bind(this)
    this.onRemoveComponent = this.onRemoveComponent.bind(this)
    this.doSort = this.doSort.bind(this)
    this.onChangeComponent = this.onChangeComponent.bind(this)
    this.facetChange = this.facetChange.bind(this)
    this.doPromptContribute = this.doPromptContribute.bind(this)
    this.doContribute = this.doContribute.bind(this)
    this.doSave = this.doSave.bind(this)
  }

  componentDidMount() {
    const { dispatch } = this.props
    dispatch(uiNavigation({ to: ROUTE_DEFINITIONS }))
  }

  onAddComponent(value, after = null) {
    const { dispatch, token, definitions } = this.props
    const component = typeof value === 'string' ? EntitySpec.fromPath(value) : value
    const path = component.toPath()
    !definitions.entries[path] && dispatch(getDefinitionsAction(token, [path]))
    dispatch(uiBrowseUpdateList({ add: component }))
  }

  onDrop(acceptedFiles, rejectedFiles) {
    const { dispatch, token, definitions } = this.props
    dispatch(uiNotificationNew({ type: 'info', message: 'Loading component list from file(s)', timeout: 5000 }))
    acceptedFiles.forEach(file => {
      const reader = new FileReader()
      reader.onload = () => {
        const listSpec = this.loadListSpec(reader.result, file)
        if (typeof listSpec === 'string') {
          const message = `Invalid component list file: ${listSpec}`
          return dispatch(uiNotificationNew({ type: 'info', message, timeout: 5000 }))
        }
        listSpec.coordinates.forEach(component => {
          // TODO figure a way to add these in bulk. One by one will be painful for large lists
          const spec = EntitySpec.validateAndCreate(component)
          if (spec) {
            const path = spec.toPath()
            !definitions.entries[path] && dispatch(getDefinitionsAction(token, [path]))
            dispatch(uiBrowseUpdateList({ add: spec }))
          }
        })
      }
      reader.readAsBinaryString(file)
    })
  }

  loadListSpec(content, file) {
    try {
      const object = JSON.parse(content)
      if (file.name.toLowerCase() === 'package-lock.json') return this.loadPackageLockFile(object.dependencies)
      if (object.coordinates) return object
      return 'No component coordinates found'
    } catch (e) {
      return e.message
    }
  }

  loadPackageLockFile(dependencies) {
    const coordinates = []
    for (const dependency in dependencies) {
      let [namespace, name] = dependency.split('/')
      if (!name) {
        name = namespace
        namespace = null
      }
      coordinates.push({ type: 'npm', provider: 'npmjs', namespace, name, revision: dependencies[dependency].version })
    }
    return { coordinates }
  }

  onSearch(value) {
    const { dispatch, token } = this.props
    dispatch(uiBrowseUpdateFilterList(token, value))
  }

  onCurate(component) {
    const url = `${ROUTE_CURATE}/${component.toPath()}`
    this.props.history.push(url)
  }

  onInspect(component) {
    const url = `${ROUTE_INSPECT}/${component.toPath()}`
    this.props.history.push(url)
  }

  onRemoveComponent(component) {
    this.props.dispatch(uiBrowseUpdateList({ remove: component }))
  }

  onChangeComponent(component, newComponent) {
    this.props.dispatch(uiBrowseUpdateList({ update: component, value: newComponent }))
  }

  hasChanges() {
    const { components } = this.props
    return components && components.list.some(entry => this.hasChange(entry))
  }

  hasComponents() {
    const { components } = this.props
    return components && components.list.length > 0
  }

  hasChange(entry) {
    return entry.changes && Object.getOwnPropertyNames(entry.changes).length
  }

  doContribute(description) {
    const { dispatch, token, components } = this.props
    const patches = this.buildContributeSpec(components.list)
    const spec = { description: description, patches }
    dispatch(curateAction(token, spec))
  }

  doSave() {
    const { components } = this.props
    const spec = this.buildSaveSpec(components.list)
    const fileObject = { filter: null, sortBy: null, coordinates: spec }
    const file = new File([JSON.stringify(fileObject, null, 2)], 'components.json')
    saveAs(file)
  }

  buildContributeSpec(list) {
    return list.reduce((result, component) => {
      if (!this.hasChange(component)) return result
      const coord = EntitySpec.asRevisionless(component)
      const patch = find(result, p => {
        return EntitySpec.isEquivalent(p.coordinates, coord)
      })
      const revisionNumber = component.revision
      const patchChanges = Object.getOwnPropertyNames(component.changes).reduce((result, change) => {
        set(result, change, component.changes[change])
        return result
      }, {})
      if (patch) {
        patch.revisions[revisionNumber] = patchChanges
      } else {
        const newPatch = { coordinates: coord, revisions: { [revisionNumber]: patchChanges } }
        result.push(newPatch)
      }
      return result
    }, [])
  }

  buildSaveSpec(list) {
    return list.reduce((result, component) => {
      result.push(EntitySpec.fromCoordinates(component))
      return result
    }, [])
  }

  doPromptContribute(proposal) {
    if (!this.hasChanges()) return
    this.refs.contributeModal.open()
  }

  name = coordinates => {
    return coordinates.name ? coordinates.name : null
  }

  namespace = coordinates => {
    return coordinates.namespace ? coordinates.namespace : null
  }

  provider = coordinates => {
    return coordinates.provider ? coordinates.provider : null
  }

  type = coordinates => {
    return coordinates.type ? coordinates.type : null
  }

  releaseDate = coordinates => {
    const definition = this.props.definitions.entries[EntitySpec.fromCoordinates(coordinates).toPath()]
    const described = get(definition, 'described')
    if (described && described.releaseDate) return described.releaseDate
    return null
  }

  license = coordinates => {
    const definition = this.props.definitions.entries[EntitySpec.fromCoordinates(coordinates).toPath()]
    const licensed = get(definition, 'licensed')
    if (licensed && licensed.declared) return licensed.declared
    return null
  }

  getSort(eventKey) {
    switch (eventKey) {
      case 'name':
        return this.name
      case 'namespace':
        return this.namespace
      case 'provider':
        return this.provider
      case 'type':
        return this.type
      case 'releaseDate':
        return this.releaseDate
      case 'license':
        return this.license
    }
  }

  doSort(eventKey) {
    this.props.dispatch(uiBrowseUpdateList({ sort: this.getSort(eventKey) }))
    this.incrementSequence()
  }

  facetChange(value) {
    const activeFacets = (value || []).map(facet => facet.value)
    this.setState({ ...this.state, activeFacets })
  }

  incrementSequence() {
    this.setState({ ...this.state, sortCounter: this.state.sortCounter + 1 })
  }

  noRowsRenderer() {
    return <div>Select components from the list above ...</div>
  }

  renderButtons() {
    return (
      <div className="pull-right">
        <DropdownButton title="Sort By" bsStyle="default" title={'Sort By'} disabled={!this.hasComponents()} id="sort">
          <MenuItem onSelect={this.doSort} eventKey="license">
            License
          </MenuItem>
          <MenuItem onSelect={this.doSort} eventKey="name">
            Name
          </MenuItem>
          <MenuItem onSelect={this.doSort} eventKey="namespace">
            Namespace
          </MenuItem>
          <MenuItem onSelect={this.doSort} eventKey="provider">
            Provider
          </MenuItem>
          <MenuItem onSelect={this.doSort} eventKey="releaseDate">
            Release Date
          </MenuItem>
          <MenuItem onSelect={this.doSort} eventKey="type">
            Type
          </MenuItem>
        </DropdownButton>
        &nbsp;
        <Button bsStyle="success" disabled={!this.hasComponents()} onClick={this.doSave}>
          Save
        </Button>
        &nbsp;
        <Button bsStyle="success" disabled={!this.hasChanges()} onClick={this.doPromptContribute}>
          Contribute
        </Button>
      </div>
    )
  }

  render() {
    const { components, filterOptions, definitions, token } = this.props
    const { activeFacets, sortCounter } = this.state
    return (
      <Grid className="main-container">
        <ContributePrompt ref="contributeModal" actionHandler={this.doContribute} />
        <Row className="show-grid spacer">
          <Col md={5}>
            <FacetSelect name="facets" onChange={this.facetChange} defaultFacets={defaultFacets} />
          </Col>
          <Col md={7}>
            <FilterBar options={filterOptions} onChange={this.onAddComponent} onSearch={this.onSearch} clearOnChange />
          </Col>
        </Row>
        <Section name={'Available definitions'} actionButton={this.renderButtons()}>
          <Dropzone disableClick onDrop={this.onDrop} style={{ position: 'relative' }}>
            <div className="section-body">
              <ComponentList
                list={components}
                listHeight={1000}
                onRemove={this.onRemoveComponent}
                onChange={this.onChangeComponent}
                onAddComponent={this.onAddComponent}
                onInspect={this.onInspect}
                onCurate={this.onCurate}
                definitions={definitions}
                githubToken={token}
                noRowsRenderer={this.noRowsRenderer}
                activeFacets={activeFacets}
                sortCounter={sortCounter}
              />
            </div>
          </Dropzone>
        </Section>
      </Grid>
    )
  }
}

function mapStateToProps(state, ownProps) {
  return {
    token: state.session.token,
    filterValue: state.ui.browse.filter,
    filterOptions: state.ui.browse.filterList,
    components: state.ui.browse.componentList,
    definitions: state.definition.bodies
  }
}
export default connect(mapStateToProps)(PageDefinitions)
